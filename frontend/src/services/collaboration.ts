/**
 * WebSocket-based real-time collaboration service.
 * Manages presence, cursor sharing, building edits, and selection broadcasts.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

export interface CollaborationUser {
  id: string;
  name: string;
  email: string;
  color: string;
  connected_at: string;
}

export interface CursorInfo {
  userId: string;
  name: string;
  color: string;
  position: [number, number, number];
  target: [number, number, number];
}

interface CollaborationMessage {
  type: string;
  [key: string]: unknown;
}

const WS_BASE = (import.meta.env.VITE_WS_URL || 'ws://localhost:8000').replace(/\/$/, '');

/**
 * React hook for project collaboration via WebSocket.
 */
export function useCollaboration(projectId: string | undefined, userName?: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const [users, setUsers] = useState<CollaborationUser[]>([]);
  const [cursors, setCursors] = useState<Map<string, CursorInfo>>(new Map());
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const onEditRef = useRef<((msg: { userId: string; name: string; buildingId: string; changes: Record<string, unknown> }) => void) | null>(null);
  const onSelectRef = useRef<((msg: { userId: string; name: string; buildingId: string }) => void) | null>(null);
  const onCameraRef = useRef<((cursor: CursorInfo) => void) | null>(null);

  const connect = useCallback(() => {
    if (!projectId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_BASE}/ws/projects/${projectId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Send join message
      ws.send(JSON.stringify({
        type: 'join',
        name: userName || 'Anonymous',
        email: '',
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg: CollaborationMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'welcome':
            setConnectionId(msg.connectionId as string);
            break;

          case 'presence':
            setUsers((msg.users as CollaborationUser[]) || []);
            break;

          case 'cursor': {
            const cursor: CursorInfo = {
              userId: msg.userId as string,
              name: msg.name as string,
              color: msg.color as string,
              position: msg.position as [number, number, number],
              target: msg.target as [number, number, number],
            };
            setCursors((prev) => {
              const next = new Map(prev);
              next.set(cursor.userId, cursor);
              return next;
            });
            // If following this user, call the camera callback
            onCameraRef.current?.(cursor);
            break;
          }

          case 'select':
            onSelectRef.current?.({
              userId: msg.userId as string,
              name: msg.name as string,
              buildingId: msg.buildingId as string,
            });
            break;

          case 'edit':
            onEditRef.current?.({
              userId: msg.userId as string,
              name: msg.name as string,
              buildingId: msg.buildingId as string,
              changes: (msg.changes as Record<string, unknown>) || {},
            });
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      // Auto-reconnect after 3 seconds
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [projectId, userName]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
      setIsConnected(false);
      setUsers([]);
      setCursors(new Map());
    };
  }, [connect]);

  // Keepalive ping every 30s
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const sendCursor = useCallback((position: [number, number, number], target: [number, number, number]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cursor', position, target }));
    }
  }, []);

  const sendSelect = useCallback((buildingId: string | null) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'select', buildingId }));
    }
  }, []);

  const sendEdit = useCallback((buildingId: string, changes: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'edit', buildingId, changes }));
    }
  }, []);

  const onEdit = useCallback((handler: typeof onEditRef.current) => {
    onEditRef.current = handler;
  }, []);

  const onSelect = useCallback((handler: typeof onSelectRef.current) => {
    onSelectRef.current = handler;
  }, []);

  const onCamera = useCallback((handler: typeof onCameraRef.current) => {
    onCameraRef.current = handler;
  }, []);

  const setFollowing = useCallback((userId: string | null) => {
    setFollowingUserId(userId);
  }, []);

  return {
    users,
    cursors,
    connectionId,
    isConnected,
    followingUserId,
    sendCursor,
    sendSelect,
    sendEdit,
    onEdit,
    onSelect,
    onCamera,
    setFollowing,
  };
}
