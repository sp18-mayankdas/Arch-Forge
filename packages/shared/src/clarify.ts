/**
 * The AI conversation contract — the full wire shape of `POST /api/generate` in both
 * directions. Lives in shared because both sides need it exactly: the backend validates the
 * model into these types, the frontend renders them.
 *
 * Like the rest of the AI contract this is topology-adjacent only. A question or a
 * suggestion may concern what the system DOES; never how it should look.
 */

import type { SemanticNode, SemanticEdge, SerializedGraph } from "./semantic";

/** One pickable answer. `description` carries the trade-off, so the user can choose
 * without already knowing the domain — that is the point of offering options at all. */
export interface ClarifyOption {
  label: string;
  description: string;
}

/**
 * A single clarifying question with concrete choices. Options rather than open prose
 * because "which sign-in methods?" is unanswerable unless you already know the menu;
 * naming the menu is most of the help.
 */
export interface ClarifyQuestion {
  /** Short chip label, e.g. "Sign-in methods". */
  header: string;
  question: string;
  /** Several answers may hold at once (e.g. auth providers) vs. exactly one (sessions vs JWTs). */
  multiSelect: boolean;
  options: ClarifyOption[];
}

/**
 * A next move worth making, offered as a one-click chip.
 *
 * `label` is BOTH the chip text and the exact message sent as the next user turn when
 * clicked — the same trick ClarifyQuestions uses, so the transcript stays plain readable
 * text and the model needs no separate answer channel. It must therefore read as an
 * instruction the user could have typed ("Add a read replica for the orders DB"), never a
 * terse noun phrase ("Read replica"), which makes a useless prompt.
 */
export interface Suggestion {
  label: string;
  /** One clause on what it buys or costs. Display only, never sent. May be "". */
  rationale: string;
}

/** One turn of the conversation as it crosses the wire. The frontend owns the transcript;
 * the backend is stateless and is handed the whole thing on every call. */
export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
  /**
   * Assistant turns only: did this turn render clarifying questions? The client is the only
   * party that knows — the transcript it posts is role + content and nothing else, so the
   * server cannot see this for itself. Used for exactly one rule (never ask twice in a row)
   * and never forwarded to the model: `readConversation` rebuilds every turn from role and
   * content, so this key cannot reach the provider payload.
   *
   * ABSENT MEANS "PRESUMED YES". A lost or forged flag must fail toward LESS asking, never
   * toward a question loop. The realistic case is a stale bundle in an open tab after a
   * deploy, which then simply gets the older one-question-at-the-start behaviour.
   */
  asked?: boolean;
}

/**
 * The `POST /api/generate` body. The server deliberately does NOT parse against this — it
 * reads each field defensively (`readConversation` / `readGraph` / `readAskedLast`) because
 * the wire is untrusted and a cast would be a lie. This exists so the client's body is
 * compile-checked against one definition. The legacy single-turn `{ prompt }` form is still
 * accepted by the server but is not part of the typed client body.
 */
export interface GenerateRequest {
  messages: AiChatTurn[];
  graph: SerializedGraph;
}

/**
 * The `POST /api/generate` response, and the server's promise: every field below is present
 * on every 200, in every branch. Typing each `res.json()` against this is the real payoff —
 * it turns "remember to add the new field to all the branches" from a review comment into a
 * compile error, which is the only protection there is, since no test asserts the body.
 *
 * The client casts parsed JSON to this. That is a claim, not a check: a new client talking
 * to an older server must still read newer fields defensively.
 */
export interface GenerateResponse {
  /** The model's reasoning for this turn. Shown collapsed. */
  thinking?: string;
  /**
   * Whether the canvas should change. An empty node list cannot carry this signal, because
   * "remove everything" is itself a legitimate edit — so this is the only thing the client
   * may branch on.
   */
  applied: boolean;
  questions: ClarifyQuestion[];
  suggestions: Suggestion[];
  nodes: SemanticNode[];
  edges: SemanticEdge[];
  summary: string;
  /**
   * On a generated design: the one thing this design costs, as a falsifiable sentence.
   * Deliberately its own field rather than a clause inside `summary` — the model fills a
   * required field far more reliably than it satisfies a constraint on prose, and keeping it
   * out of `summary` keeps it out of the transcript, where a caveat would otherwise be
   * resent every turn and start reading as an established requirement.
   */
  tradeoff?: string;
}
