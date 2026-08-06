import { useState, useCallback, useMemo } from "react";
import { Check, CornerDownLeft, Wand2 } from "lucide-react";
import type { ClarifyQuestion } from "@/types/canvas";
import { cn } from "@/lib/utils";

interface ClarifyQuestionsProps {
  questions: ClarifyQuestion[];
  /** False once a later message exists — a past round becomes a read-only record. */
  active: boolean;
  disabled: boolean;
  onSubmit: (answer: string) => void;
}

/**
 * Renders a clarifying round as pickable options and folds the picks into one plain
 * sentence for the next user turn. The transcript therefore stays readable text, and the
 * model needs no separate answer channel — it just reads the reply like any other.
 */
export function ClarifyQuestions({
  questions,
  active,
  disabled,
  onSubmit,
}: ClarifyQuestionsProps) {
  // question index -> chosen labels
  const [picked, setPicked] = useState<Record<number, string[]>>({});

  const toggle = useCallback(
    (qIndex: number, label: string, multiSelect: boolean) => {
      setPicked((prev) => {
        const current = prev[qIndex] ?? [];
        if (!multiSelect) {
          // Re-picking the selected option clears it, so a single-select is escapable.
          return { ...prev, [qIndex]: current[0] === label ? [] : [label] };
        }
        return {
          ...prev,
          [qIndex]: current.includes(label)
            ? current.filter((l) => l !== label)
            : [...current, label],
        };
      });
    },
    []
  );

  const answer = useMemo(
    () =>
      questions
        .map((q, i) => {
          const chosen = picked[i] ?? [];
          return chosen.length ? `${q.header}: ${chosen.join(", ")}` : null;
        })
        .filter(Boolean)
        .join(". "),
    [questions, picked]
  );

  const hasPicks = answer.length > 0;

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
      {questions.map((q, qIndex) => {
        const chosen = picked[qIndex] ?? [];
        return (
          <div key={`${q.header}-${qIndex}`} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="rounded-md bg-[#6457f9]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#a89dfc]">
                {q.header}
              </span>
              {q.multiSelect && (
                <span className="text-[10px] text-white/25">pick any</span>
              )}
            </div>
            <p className="text-xs leading-5 text-white/70">{q.question}</p>
            <div className="flex flex-col gap-1">
              {q.options.map((opt) => {
                const isPicked = chosen.includes(opt.label);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    disabled={!active || disabled}
                    onClick={() => toggle(qIndex, opt.label, q.multiSelect)}
                    className={cn(
                      "group flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors",
                      isPicked
                        ? "border-[#6457f9]/60 bg-[#6457f9]/15"
                        : "border-white/8 bg-white/[0.03] hover:bg-white/[0.07]",
                      (!active || disabled) && "cursor-default opacity-70"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center border",
                        q.multiSelect ? "rounded-[4px]" : "rounded-full",
                        isPicked
                          ? "border-[#6457f9] bg-[#6457f9]"
                          : "border-white/20 group-hover:border-white/40"
                      )}
                    >
                      {isPicked && <Check className="h-2.5 w-2.5 text-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-medium text-white/90">
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className="mt-0.5 block text-[10px] leading-4 text-white/40">
                          {opt.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {active && (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            disabled={!hasPicks || disabled}
            onClick={() => onSubmit(answer)}
            className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#6457f9] px-3 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <CornerDownLeft className="h-3 w-3" />
            {hasPicks ? "Send answers" : "Pick to continue"}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSubmit("Just build it — use your judgement.")}
            title="Skip the questions and let ArchForge choose sensible defaults"
            className="flex h-7 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-[11px] text-white/60 transition-colors hover:bg-white/8 hover:text-white disabled:opacity-40"
          >
            <Wand2 className="h-3 w-3" />
            Just build it
          </button>
        </div>
      )}
      {active && (
        <p className="text-[10px] leading-4 text-white/25">
          Or type your own answer below — anything you skip, I&apos;ll pick a sensible default for.
        </p>
      )}
    </div>
  );
}
