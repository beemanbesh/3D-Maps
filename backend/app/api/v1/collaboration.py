"""
WebSocket-based real-time collaboration for project viewers.
Handles presence, building edit broadcasts, and shared camera positions.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()


class ConnectionManager:
    """Manages WebSocket connections grouped by project room."""

    def __init__(self):
        # project_id -> {connection_id -> {"ws": WebSocket, "user": {...}}}
        self.rooms: dict[str, dict[str, dict[str, Any]]] = {}

    async def connect(self, project_id: str, websocket: WebSocket, user_info: dict) -> str:
        await websocket.accept()
        conn_id = str(uuid.uuid4())[:8]
        if project_id not in self.rooms:
            self.rooms[project_id] = {}
        self.rooms[project_id][conn_id] = {
            "ws": websocket,
            "user": user_info,
            "connected_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.info(f"WS connect: {user_info.get('name', 'anon')} -> project {project_id} ({conn_id})")
        return conn_id

    def disconnect(self, project_id: str, conn_id: str):
        room = self.rooms.get(project_id)
        if room and conn_id in room:
            user = room[conn_id].get("user", {})
            del room[conn_id]
            logger.info(f"WS disconnect: {user.get('name', 'anon')} from project {project_id}")
            if not room:
                del self.rooms[project_id]

    def get_presence(self, project_id: str) -> list[dict]:
        """Get list of users currently connected to a project."""
        room = self.rooms.get(project_id, {})
        return [
            {
                "id": conn_id,
                "name": info["user"].get("name", "Anonymous"),
                "email": info["user"].get("email", ""),
                "color": info["user"].get("color", "#6366f1"),
                "connected_at": info["connected_at"],
            }
            for conn_id, info in room.items()
        ]

    async def broadcast(self, project_id: str, message: dict, exclude_conn: str | None = None):
        """Send a message to all connections in a project room."""
        room = self.rooms.get(project_id, {})
        dead = []
        for conn_id, info in room.items():
            if conn_id == exclude_conn:
                continue
            try:
                await info["ws"].send_json(message)
            except Exception:
                dead.append(conn_id)
        for conn_id in dead:
            self.disconnect(project_id, conn_id)


manager = ConnectionManager()

# Palette for assigning colors to users
USER_COLORS = [
    "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6",
    "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#06b6d4",
]


@router.websocket("/ws/projects/{project_id}")
async def project_collaboration(websocket: WebSocket, project_id: str):
    """
    WebSocket endpoint for real-time project collaboration.

    Client sends JSON messages with a "type" field:
    - {"type": "join", "name": "...", "email": "..."} — announce presence
    - {"type": "cursor", "position": [x,y,z], "target": [x,y,z]} — camera position
    - {"type": "select", "buildingId": "..."} — building selection
    - {"type": "edit", "buildingId": "...", "changes": {...}} — building edit
    - {"type": "ping"} — keepalive

    Server broadcasts:
    - {"type": "presence", "users": [...]} — updated user list
    - {"type": "cursor", "userId": "...", "name": "...", "position": [...], "target": [...]}
    - {"type": "select", "userId": "...", "name": "...", "buildingId": "..."}
    - {"type": "edit", "userId": "...", "name": "...", "buildingId": "...", "changes": {...}}
    - {"type": "pong"} — keepalive response
    """
    # Assign a color based on current room size
    room_size = len(manager.rooms.get(project_id, {}))
    user_color = USER_COLORS[room_size % len(USER_COLORS)]

    user_info = {"name": "Anonymous", "email": "", "color": user_color}
    conn_id = await manager.connect(project_id, websocket, user_info)

    try:
        # Send initial presence
        await websocket.send_json({
            "type": "welcome",
            "connectionId": conn_id,
            "color": user_color,
        })

        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "join":
                # Update user info
                user_info["name"] = msg.get("name", "Anonymous")
                user_info["email"] = msg.get("email", "")
                manager.rooms[project_id][conn_id]["user"] = user_info
                # Broadcast updated presence to everyone
                await manager.broadcast(project_id, {
                    "type": "presence",
                    "users": manager.get_presence(project_id),
                })

            elif msg_type == "cursor":
                # Broadcast camera position to others
                await manager.broadcast(project_id, {
                    "type": "cursor",
                    "userId": conn_id,
                    "name": user_info.get("name", "Anonymous"),
                    "color": user_info.get("color", "#6366f1"),
                    "position": msg.get("position"),
                    "target": msg.get("target"),
                }, exclude_conn=conn_id)

            elif msg_type == "select":
                await manager.broadcast(project_id, {
                    "type": "select",
                    "userId": conn_id,
                    "name": user_info.get("name", "Anonymous"),
                    "buildingId": msg.get("buildingId"),
                }, exclude_conn=conn_id)

            elif msg_type == "edit":
                await manager.broadcast(project_id, {
                    "type": "edit",
                    "userId": conn_id,
                    "name": user_info.get("name", "Anonymous"),
                    "buildingId": msg.get("buildingId"),
                    "changes": msg.get("changes", {}),
                }, exclude_conn=conn_id)

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WebSocket error for {conn_id}: {e}")
    finally:
        manager.disconnect(project_id, conn_id)
        # Broadcast updated presence after disconnect
        try:
            await manager.broadcast(project_id, {
                "type": "presence",
                "users": manager.get_presence(project_id),
            })
        except Exception:
            pass
