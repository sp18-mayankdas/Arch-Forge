import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  readStoredSidebarWidth,
} from "@/lib/sidebar-width";

/**
 * Drag-to-resize for the assistant panel, plus per-browser persistence.
 *
 * The only place in this feature that touches `window` — the clamping and parsing live in
 * lib/sidebar-width.ts so they can be tested without a DOM.
 *
 * Uses pointer CAPTURE rather than window-level listeners: the pointer keeps reporting to the
 * handle even once it has moved over the React Flow canvas, which would otherwise swallow the
 * events and start panning mid-drag.
 */
export function useSidebarWidth() {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined"
      ? DEFAULT_SIDEBAR_WIDTH
      : readStoredSidebarWidth(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)),
  );
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    // The panel is pinned to the right edge, so its width is the distance from the pointer to
    // that edge.
    setWidth(clampSidebarWidth(window.innerWidth - e.clientX));
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDragging(false);
      // Persisted on release, not on every move: a drag fires dozens of moves and a
      // localStorage write is synchronous.
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
      } catch {
        // Private browsing or a full quota. The width still applies for this session.
      }
    },
    [width],
  );

  // A drag across the panel would otherwise select the whole transcript.
  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = previous;
    };
  }, [dragging]);

  return { width, dragging, handleProps: { onPointerDown, onPointerMove, onPointerUp } };
}
