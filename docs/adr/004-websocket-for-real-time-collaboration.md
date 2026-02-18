# ADR-004: WebSocket for Real-Time Collaboration

**Status:** Accepted
**Date:** 2026-02-01
**Decision Makers:** Engineering Team

## Context

The 3D viewer supports multiple users viewing the same project simultaneously. We need real-time features: presence indicators, shared camera positions (follow mode), building edit broadcasts, and selection synchronization. These require bi-directional, low-latency communication.

### Options Considered

1. **WebSocket (FastAPI native)** — Raw WebSocket connections
2. **Socket.IO** — Higher-level real-time framework with auto-reconnect
3. **Server-Sent Events (SSE)** — One-way server-to-client push
4. **HTTP polling** — Regular interval fetching

## Decision

We chose **FastAPI native WebSocket** support with a custom ConnectionManager.

## Rationale

- **Bi-directional:** Camera positions and building selections need to flow both client-to-server and server-to-client. WebSocket is purpose-built for this.
- **Low latency:** Camera follow mode broadcasts at ~10fps. WebSocket's persistent TCP connection eliminates HTTP overhead per message.
- **FastAPI integration:** FastAPI has first-class WebSocket support — endpoints are defined alongside REST routes with the same dependency injection system.
- **Simplicity:** Our ConnectionManager (rooms, connections, broadcast) is ~80 lines of Python. Socket.IO would add a significant dependency for features we don't need (namespaces, binary transport, room ACKs).
- **In-memory state:** Connection state lives in the Python process. For our target scale (<100 concurrent viewers per project), this is sufficient without external pub/sub.

### Why Not Others

- **Socket.IO** adds ~50KB to the frontend bundle and requires a separate server adapter. Our needs are simple enough for raw WebSocket.
- **SSE** is one-directional — we'd need separate POST endpoints for client actions, making the protocol more complex.
- **HTTP polling** at 10fps for camera positions would generate 600 requests/minute per user — wasteful and higher latency.

## Consequences

### Positive

- Near-instant (<50ms) message delivery for presence, camera sync, and edit notifications
- Minimal additional dependencies — no new packages needed
- Clean message protocol with typed JSON messages (join, cursor, select, edit, ping/pong)
- Auto-reconnect in the frontend hook with 3-second backoff

### Negative

- In-memory ConnectionManager doesn't scale beyond a single API process. Multi-instance deployment would need Redis pub/sub for cross-process broadcast.
- No built-in message acknowledgment — messages are fire-and-forget
- WebSocket connections don't survive server restarts (frontend auto-reconnects)
- No authentication on WebSocket endpoint (would need token validation for production)
