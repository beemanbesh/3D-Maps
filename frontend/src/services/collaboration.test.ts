import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCollaboration } from './collaboration';

// Mock WebSocket
class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = 1; // OPEN
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sentMessages: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    // Simulate async connection
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  // Test helpers
  simulateMessage(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  accept() {
    this.readyState = 1;
    this.onopen?.();
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  (globalThis as any).WebSocket = MockWebSocket;
});

afterEach(() => {
  MockWebSocket.instances = [];
});

describe('useCollaboration', () => {
  it('connects to WebSocket with project ID', async () => {
    const { result } = renderHook(() => useCollaboration('project-1', 'Alice'));

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1);
      expect(MockWebSocket.instances[0].url).toContain('/ws/projects/project-1');
    });

    result.current; // access to prevent unused warning
  });

  it('sends join message on connect', async () => {
    renderHook(() => useCollaboration('project-1', 'Alice'));

    await waitFor(() => {
      const ws = MockWebSocket.instances[0];
      expect(ws.sentMessages.length).toBeGreaterThanOrEqual(1);
      const joinMsg = JSON.parse(ws.sentMessages[0]);
      expect(joinMsg.type).toBe('join');
      expect(joinMsg.name).toBe('Alice');
    });
  });

  it('updates users on presence message', async () => {
    const { result } = renderHook(() => useCollaboration('project-1', 'Alice'));

    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.simulateMessage({
        type: 'presence',
        users: [
          { id: 'a', name: 'Alice', email: 'a@b.com', color: '#6366f1', connected_at: '' },
          { id: 'b', name: 'Bob', email: 'b@b.com', color: '#ec4899', connected_at: '' },
        ],
      });
    });

    expect(result.current.users).toHaveLength(2);
    expect(result.current.users[0].name).toBe('Alice');
    expect(result.current.users[1].name).toBe('Bob');
  });

  it('handles welcome message with connectionId', async () => {
    const { result } = renderHook(() => useCollaboration('project-1', 'Alice'));

    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.simulateMessage({ type: 'welcome', connectionId: 'abc123', color: '#6366f1' });
    });

    expect(result.current.connectionId).toBe('abc123');
  });

  it('sends cursor position', async () => {
    const { result } = renderHook(() => useCollaboration('project-1', 'Alice'));

    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    act(() => {
      result.current.sendCursor([10, 20, 30], [0, 0, 0]);
    });

    const ws = MockWebSocket.instances[0];
    const cursorMsg = ws.sentMessages.find((m) => JSON.parse(m).type === 'cursor');
    expect(cursorMsg).toBeDefined();
    const parsed = JSON.parse(cursorMsg!);
    expect(parsed.position).toEqual([10, 20, 30]);
    expect(parsed.target).toEqual([0, 0, 0]);
  });

  it('sends building selection', async () => {
    const { result } = renderHook(() => useCollaboration('project-1', 'Alice'));

    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    act(() => {
      result.current.sendSelect('building-42');
    });

    const ws = MockWebSocket.instances[0];
    const selectMsg = ws.sentMessages.find((m) => JSON.parse(m).type === 'select');
    expect(selectMsg).toBeDefined();
    expect(JSON.parse(selectMsg!).buildingId).toBe('building-42');
  });

  it('sends building edit', async () => {
    const { result } = renderHook(() => useCollaboration('project-1', 'Alice'));

    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    act(() => {
      result.current.sendEdit('building-42', { height_meters: 25 });
    });

    const ws = MockWebSocket.instances[0];
    const editMsg = ws.sentMessages.find((m) => JSON.parse(m).type === 'edit');
    expect(editMsg).toBeDefined();
    const parsed = JSON.parse(editMsg!);
    expect(parsed.buildingId).toBe('building-42');
    expect(parsed.changes.height_meters).toBe(25);
  });

  it('does not connect when projectId is undefined', () => {
    renderHook(() => useCollaboration(undefined, 'Alice'));
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it('updates cursors on cursor message', async () => {
    const { result } = renderHook(() => useCollaboration('project-1', 'Alice'));

    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.simulateMessage({
        type: 'cursor',
        userId: 'bob',
        name: 'Bob',
        color: '#ec4899',
        position: [1, 2, 3],
        target: [4, 5, 6],
      });
    });

    expect(result.current.cursors.size).toBe(1);
    const cursor = result.current.cursors.get('bob');
    expect(cursor?.name).toBe('Bob');
    expect(cursor?.position).toEqual([1, 2, 3]);
  });
});
