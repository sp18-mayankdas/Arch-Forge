import { useCallback, useEffect, useMemo, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import { applySelectChanges, pruneFocus, type SelectChange } from "@/lib/focus";

interface UseFocusProps {
  /** Ids of the nodes currently on the canvas, used to prune marks for deleted nodes. */
  liveNodeIds: string[];
  awareness: Awareness;
}

/**
 * Owns the marked-node set — the scope of the next AI prompt.
 *
 * React state is the store and awareness is a MIRROR, never the other way round. Awareness is
 * designed to be lossy (a peer's state is dropped on disconnect timeout), so driving the set
 * from it would silently empty someone's scope mid-sentence on a network blip. A Yjs map is
 * wrong for the opposite reason: it would persist a departed peer's marks forever and need
 * hand-rolled GC, which is exactly why `cursor` lives in awareness too.
 *
 * It lives at App level because AiSidebar sits OUTSIDE the ReactFlowProvider that wraps the
 * canvas, so no React Flow hook is reachable from the component that has to render the focus
 * chips and build the request body. App is the lowest common ancestor.
 */
export function useFocus({ liveNodeIds, awareness }: UseFocusProps) {
  const [focusIds, setFocusIds] = useState<string[]>([]);

  // Keyed on a STRING of the live ids, not the array: buildNodes returns a brand-new array on
  // every Yjs change, including a remote peer's drag, so an array dependency would re-run this
  // constantly. pruneFocus returning the same reference when nothing was removed is what stops
  // the setState below from looping.
  const liveKey = liveNodeIds.join(",");
  useEffect(() => {
    const live = new Set(liveKey ? liveKey.split(",") : []);
    setFocusIds((prev) => pruneFocus(prev, live));
  }, [liveKey]);

  // Mirror onto the wire. No throttling: a mark is a click, and GhostCanvas already broadcasts
  // an unthrottled cursor on every mousemove, so this is orders of magnitude cheaper.
  useEffect(() => {
    awareness.setLocalStateField("focus", focusIds);
  }, [awareness, focusIds]);

  /** Folds React Flow's `select` changes in — this is how every marking gesture arrives. */
  const applySelection = useCallback((changes: SelectChange[]) => {
    setFocusIds((prev) => applySelectChanges(prev, changes));
  }, []);

  const unfocus = useCallback((id: string) => {
    setFocusIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev));
  }, []);

  const clearFocus = useCallback(() => {
    setFocusIds((prev) => (prev.length === 0 ? prev : []));
  }, []);

  // Escape clears, but only when the user is not typing — otherwise dismissing an autocomplete
  // or pressing Escape out of habit in the composer would wipe the scope of the very message
  // being written.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      ) {
        return;
      }
      clearFocus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearFocus]);

  const focusSet = useMemo(() => new Set(focusIds), [focusIds]);

  return { focusIds, focusSet, applySelection, unfocus, clearFocus };
}
