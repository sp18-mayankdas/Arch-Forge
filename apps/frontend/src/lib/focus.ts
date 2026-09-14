/**
 * Focus — which nodes the user has marked as the scope of their next AI prompt.
 *
 * A third layer alongside semantic and presentation, and the only one that is PER-VIEWER:
 * it is one person's intent for one turn, so it never enters the Yjs maps, never becomes a
 * SemanticOp, and never bumps the version counter. It is broadcast over awareness exactly the
 * way `cursor` is, and garbage-collected the same way when a peer disconnects.
 *
 * Pure and dependency-free, like lib/sidebar-width.ts, so all of it is testable in the node
 * environment the frontend's Vitest runs in.
 */

/** A marked node, snapshotted with its label. */
export interface FocusRef {
  id: string;
  label: string;
}

/** One peer's mark on one node — what the canvas needs to draw a coloured ring. */
export interface PeerMark {
  userId: string;
  name: string;
  color: string;
}

/** The subset of a React Flow `select` NodeChange this module cares about. */
export interface SelectChange {
  id: string;
  selected: boolean;
}

/**
 * Folds React Flow's `select` changes into the marked set.
 *
 * Marking IS selection: a plain click, a shift-drag box select, a cmd-click and a click on
 * empty pane all arrive here as select changes, which is why none of those gestures needs a
 * handler of its own.
 *
 * Returns the SAME array reference when nothing changed. That identity guarantee is
 * load-bearing everywhere this value is a hook dependency — see pruneFocus.
 */
export function applySelectChanges(current: string[], changes: SelectChange[]): string[] {
  if (changes.length === 0) return current;

  const next = current.slice();
  let touched = false;

  for (const change of changes) {
    const at = next.indexOf(change.id);
    if (change.selected && at === -1) {
      // Appended, so the array stays in the order the user marked things — that is the order
      // the chips render in and the order the ids reach the model.
      next.push(change.id);
      touched = true;
    } else if (!change.selected && at !== -1) {
      next.splice(at, 1);
      touched = true;
    }
  }

  return touched ? next : current;
}

/**
 * Drops marks for nodes that no longer exist — deleted by you, by a peer, or by an AI apply.
 * A phantom id would render a chip for a node nobody can see and put a dangling id on the
 * request body.
 *
 * MUST return the identical reference when nothing was removed: the caller runs this in an
 * effect that also sets state, so without React's `Object.is` bail-out it is an infinite
 * render loop. That is why the test for this asserts `toBe`, not `toEqual`.
 */
export function pruneFocus(current: string[], liveIds: ReadonlySet<string>): string[] {
  const kept = current.filter((id) => liveIds.has(id));
  return kept.length === current.length ? current : kept;
}

/** Ids to display refs. Unknown ids are dropped rather than rendered as "(deleted)". */
export function resolveFocus(ids: string[], labels: ReadonlyMap<string, string>): FocusRef[] {
  const refs: FocusRef[] = [];
  for (const id of ids) {
    const label = labels.get(id);
    if (label !== undefined) refs.push({ id, label });
  }
  return refs;
}

/** "Orders DB", "Orders DB, API Gateway", "Orders DB, API Gateway +2". */
export function summarizeFocus(refs: readonly FocusRef[], shown = 2): string {
  if (refs.length === 0) return "";
  const head = refs.slice(0, shown).map((r) => r.label);
  const rest = refs.length - head.length;
  return rest > 0 ? `${head.join(", ")} +${rest}` : head.join(", ");
}

/** What each peer has marked, indexed by node id, so a node can look up its own rings. */
export function groupPeerFocus(
  peers: readonly { userId: string; name: string; color: string; focus?: string[] }[],
): Map<string, PeerMark[]> {
  const byNode = new Map<string, PeerMark[]>();
  for (const peer of peers) {
    // Tolerates a peer on a bundle that predates the field: no focus is an empty focus.
    if (!Array.isArray(peer.focus) || peer.focus.length === 0) continue;
    const mark: PeerMark = { userId: peer.userId, name: peer.name, color: peer.color };
    for (const id of peer.focus) {
      const marks = byNode.get(id);
      if (marks) marks.push(mark);
      else byNode.set(id, [mark]);
    }
  }
  return byNode;
}

/**
 * A string that changes only when somebody's marks change.
 *
 * The collaborators array is rebuilt from scratch on every remote MOUSEMOVE, so memoising the
 * peer-focus map on that array would churn its identity ~60x a second and re-render every node
 * in the room to redraw rings that did not move. Memoise on this instead.
 */
export function peerFocusKey(
  peers: readonly { userId: string; focus?: string[] }[],
): string {
  return peers.map((p) => `${p.userId}:${(p.focus ?? []).join("~")}`).join("|");
}
