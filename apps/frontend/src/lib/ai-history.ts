import type { AiChatTurn, ClarifyQuestion } from "@/types/canvas";

/** The subset of a rendered message the wire cares about. */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
  questions?: ClarifyQuestion[];
}

/**
 * The transcript as the wire wants it.
 *
 * `asked` is DERIVED from the questions actually rendered — the same state that drives the
 * question card — so the signal the server paces itself by cannot drift from what the user
 * saw. It is set EXPLICITLY on every assistant turn, including `false`: the server presumes
 * an absent flag means "asked" (see `AiChatTurn.asked`), so omitting it on a turn that did
 * not ask would silently suppress the next legitimate question.
 *
 * User turns carry no flag at all — it is meaningless there, and the server only inspects
 * assistant turns.
 */
export function toChatHistory(messages: HistoryMessage[]): AiChatTurn[] {
  return messages.map((m) =>
    m.role === "assistant"
      ? {
          role: "assistant" as const,
          content: m.content,
          asked: (m.questions?.length ?? 0) > 0,
        }
      : { role: "user" as const, content: m.content },
  );
}
