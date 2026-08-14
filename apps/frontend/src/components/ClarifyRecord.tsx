import { HelpCircle } from "lucide-react";
import type { ClarifyQuestion } from "@/types/canvas";

interface ClarifyRecordProps {
  questions: ClarifyQuestion[];
  /** Present only for a live round the viewer set aside — brings the stepper back. */
  onReopen?: () => void;
}

/**
 * A clarifying round, compacted to one line.
 *
 * Past rounds are a record, not an interface: the picks are already visible as the user's next
 * message, so re-rendering three questions and twelve options under every answered turn is
 * clutter that grows with the conversation. Only the live round is answerable, and it is answered
 * in the composer slot (see ClarifyStepper).
 */
export function ClarifyRecord({ questions, onReopen }: ClarifyRecordProps) {
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
      <span className="flex items-center gap-1 text-[10px] font-medium text-white/25">
        <HelpCircle className="h-2.5 w-2.5" />
        {questions.length === 1 ? "1 question" : `${questions.length} questions`}
      </span>
      <div className="flex flex-wrap gap-1">
        {questions.map((q, i) => (
          <span
            key={`${q.header}-${i}`}
            title={q.question}
            className="rounded-md bg-[#6457f9]/15 px-1.5 py-0.5 text-[10px] text-[#a89dfc]"
          >
            {q.header}
          </span>
        ))}
      </div>
      {onReopen && (
        <button
          type="button"
          onClick={onReopen}
          className="self-start text-[10px] font-medium text-[#a89dfc] transition-opacity hover:opacity-80"
        >
          Answer questions
        </button>
      )}
    </div>
  );
}
