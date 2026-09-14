// Live in-memory Yjs rooms, so a room can be evicted when its project is deleted or its
// access rules change.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { docs } = require("y-websocket/bin/utils") as {
  docs: Map<string, { conns: Map<{ close?: () => void }, unknown> }>;
};

/**
 * The room name for a WebSocket URL — and the reason this is a named function rather than an
 * inline expression.
 *
 * y-websocket derives the room ITSELF, internally, as `(req.url || '').slice(1).split('?')[0]`
 * (see `y-websocket/bin/utils.cjs`, the `docName` default). If the upgrade guard computed the
 * room even slightly differently, we would authorize one room and then open another — the
 * worst possible failure for an access check, because it looks like it is working.
 *
 * So this is the single definition: the guard calls it, and `setupWSConnection` is handed the
 * result explicitly as `docName` rather than being left to re-derive it. Keep them that way.
 */
export function roomIdFromUrl(url: string | undefined): string {
  return decodeURIComponent((url ?? "").slice(1).split("?")[0]);
}

/**
 * Disconnect everyone in a room, so they reconnect and re-pass the access check.
 *
 * Blunt on purpose: it drops every peer, not just the ones who lost access. Closing only the
 * losers would mean tracking which socket belongs to which user, and a mistake there leaves
 * someone connected to a canvas they were just removed from. A reconnect costs the survivors
 * a moment; the alternative leaks the document.
 */
export function evictRoom(projectId: string): void {
  const doc = docs.get(projectId);
  if (!doc) return;
  for (const conn of doc.conns.keys()) conn.close?.();
}
