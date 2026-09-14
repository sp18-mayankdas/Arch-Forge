import { createContext, useContext } from "react";
import type { PeerMark } from "@/lib/focus";

/**
 * What each peer has marked, indexed by node id.
 *
 * A context rather than a prop because React Flow constructs node components itself — there is
 * no call site to thread a prop through. The node draws its own ring instead of an overlay
 * sibling of PresenceCursors: an overlay would have to reconstruct node geometry and then draw
 * a ring around a diamond, hexagon or cylinder, and would look wrong on half the shapes.
 *
 * The local mark is NOT in here. Marking is React Flow selection, so a node already receives it
 * as the `selected` prop.
 */
const PeerFocusContext = createContext<Map<string, PeerMark[]>>(new Map());

export const PeerFocusProvider = PeerFocusContext.Provider;

/** Empty by default, so a node still renders outside a provider (tests, storybook). */
export function usePeerMarks(nodeId: string): PeerMark[] {
  return useContext(PeerFocusContext).get(nodeId) ?? [];
}
