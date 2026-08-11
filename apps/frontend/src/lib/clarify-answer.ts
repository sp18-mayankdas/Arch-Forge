import type { ClarifyQuestion } from "@/types/canvas";

/**
 * The waiver phrase.
 *
 * The backend prompt matches on it to treat a requirement slot as resolved and to stop re-asking
 * that question, so it is a contract between the stepper and the prompt even though no type
 * mentions it. Change it here and in `buildSystemPrompt`, or not at all.
 */
export const WAIVED = "you decide";

export interface ClarifyAnswerState {
  /** question index -> chosen option labels */
  picked: Record<number, string[]>;
  /** question index -> free text from the "Other…" card */
  other: Record<number, string>;
  /** question index -> the user pressed Skip */
  skipped: Record<number, boolean>;
}

/**
 * A round of picks as one plain sentence, sent as an ordinary user turn.
 *
 * Folding rather than inventing an answer channel is what keeps the transcript readable and the
 * model unchanged: it reads the reply exactly like any other message, and the whole exchange is
 * resent verbatim on every later turn.
 *
 * EVERY question contributes a clause — answered ones name the picks, skipped and unreached ones
 * say WAIVED. Silence would be worse than verbose here: an omitted question is indistinguishable
 * from one that was never asked, so the model would put it straight back on the next turn.
 */
export function foldAnswers(
  questions: ClarifyQuestion[],
  state: ClarifyAnswerState,
): string {
  return questions
    .map((q, i) => {
      if (state.skipped[i]) return `${q.header}: ${WAIVED}`;
      const items = [...(state.picked[i] ?? [])];
      const other = state.other[i]?.trim();
      if (other) items.push(other);
      return `${q.header}: ${items.length ? items.join(", ") : WAIVED}`;
    })
    .join(". ");
}
