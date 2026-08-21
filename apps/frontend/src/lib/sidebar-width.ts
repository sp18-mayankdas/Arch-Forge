/**
 * Sidebar width, as pure functions.
 *
 * Panel width is PRESENTATION and per-viewer: it lives in localStorage, never in the Yjs doc. A
 * peer dragging their own panel narrower must not move anyone else's — the same instinct that
 * keeps `positions` out of the semantic maps.
 *
 * Split from the hook that consumes it so the clamping stays testable: the frontend Vitest setup
 * runs in the node environment with no jsdom, so nothing in this file may touch `window` or
 * `localStorage`.
 */

/** Below this the transcript and the question stepper stop being readable. */
export const MIN_SIDEBAR_WIDTH = 320;
/** Above this the panel covers most of the canvas it exists to annotate. */
export const MAX_SIDEBAR_WIDTH = 720;
export const DEFAULT_SIDEBAR_WIDTH = 384;
export const SIDEBAR_WIDTH_KEY = "archforge.sidebar.width";

export function clampSidebarWidth(px: number): number {
  // A NaN width renders as a zero-width panel whose resize handle cannot be grabbed again, so
  // the fallback here is the default rather than the minimum.
  if (!Number.isFinite(px)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(px)));
}

/** Takes the raw stored string rather than reading storage itself, so it stays pure. */
export function readStoredSidebarWidth(raw: string | null): number {
  if (!raw) return DEFAULT_SIDEBAR_WIDTH;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH;
  return clampSidebarWidth(parsed);
}
