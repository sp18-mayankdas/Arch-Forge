import { useCallback, useState, type KeyboardEvent } from "react";
import { Check, ChevronLeft, ChevronRight, CornerDownLeft, Keyboard } from "lucide-react";
import type { ClarifyQuestion } from "@/types/canvas";
import { cn } from "@/lib/utils";
import { foldAnswers, type ClarifyAnswerState } from "@/lib/clarify-answer";

interface ClarifyStepperProps {
  questions: ClarifyQuestion[];
  disabled: boolean;
  /** Sends the folded picks as an ordinary user turn — the channel suggestion chips also use. */
  onSubmit: (answer: string) => void;
  /** Hands the composer back without answering. The round stays reopenable from its record. */
  onDismiss: () => void;
}

/**
 * One clarifying question at a time, in the composer slot.
 *
 * It REPLACES the text box while a round is live rather than sitting above it: two inputs on
 * screen at once leaves it ambiguous whether to type or pick, and the round is the thing to act
 * on. "Type my own answer instead" hands the box back to anyone who would rather write prose.
 *
 * "Other…" and "Skip" are added HERE, not asked of the model: the wire contract carries neither,
 * so the model cannot forget to offer them and no question can arrive without an escape.
 *
 * All state is local and per-viewer. The round itself lives in the shared Yjs transcript, so every
 * peer sees the questions, but a half-filled stepper is nobody else's business. If a peer answers
 * first, their turn appends to the transcript, the round stops being the last message, and
 * AiSidebar unmounts this component.
 */
export function ClarifyStepper({
  questions,
  disabled,
  onSubmit,
  onDismiss,
}: ClarifyStepperProps) {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [otherOpen, setOtherOpen] = useState<Record<number, boolean>>({});
  const [skipped, setSkipped] = useState<Record<number, boolean>>({});

  const q = questions[step];
  const isLast = step === questions.length - 1;
  const chosen = picked[step] ?? [];
  const otherText = other[step]?.trim() ?? "";
  const answerable = chosen.length > 0 || otherText.length > 0;

  const advance = useCallback(
    (state: ClarifyAnswerState) => {
      if (isLast) onSubmit(foldAnswers(questions, state));
      else setStep((s) => s + 1);
    },
    [isLast, onSubmit, questions],
  );

  const toggle = useCallback(
    (label: string) => {
      // Picking after a Skip un-skips it: otherwise the fold would report a waiver over a pick.
      setSkipped((prev) => ({ ...prev, [step]: false }));
      setPicked((prev) => {
        const current = prev[step] ?? [];
        if (!q.multiSelect) {
          // Re-picking the selected option clears it, so a single-select is escapable.
          return { ...prev, [step]: current[0] === label ? [] : [label] };
        }
        return {
          ...prev,
          [step]: current.includes(label)
            ? current.filter((l) => l !== label)
            : [...current, label],
        };
      });
    },
    [q.multiSelect, step],
  );

  const toggleOther = useCallback(() => {
    setSkipped((prev) => ({ ...prev, [step]: false }));
    setOtherOpen((prev) => ({ ...prev, [step]: !prev[step] }));
  }, [step]);

  const handleNext = useCallback(() => {
    if (!answerable) return;
    advance({ picked, other, skipped });
  }, [advance, answerable, other, picked, skipped]);

  const handleSkip = useCallback(() => {
    const next = { ...skipped, [step]: true };
    setSkipped(next);
    // Picks made before pressing Skip are dropped, so the folded clause says exactly one thing.
    advance({ picked, other, skipped: next });
  }, [advance, other, picked, skipped, step]);

  const handleBack = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Enter") return;
      // Enter inserts a newline in the free-text box; Cmd/Ctrl+Enter advances from there.
      const inTextarea = (e.target as HTMLElement).tagName === "TEXTAREA";
      if (inTextarea && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      handleNext();
    },
    [handleNext],
  );

  return (
    <div
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] p-3"
    >
      <div className="flex items-center gap-1.5">
        <span className="rounded-md bg-[#6457f9]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#a89dfc]">
          {q.header}
        </span>
        {q.multiSelect && <span className="text-[10px] text-white/25">pick any</span>}
        <span className="ml-auto text-[10px] tabular-nums text-white/30">
          {step + 1} of {questions.length}
        </span>
      </div>

      <p className="text-xs leading-5 text-white/70">{q.question}</p>

      <div className="flex flex-col gap-1">
        {q.options.map((opt) => {
          const isPicked = chosen.includes(opt.label);
          return (
            <button
              key={opt.label}
              type="button"
              disabled={disabled}
              onClick={() => toggle(opt.label)}
              className={cn(
                "group flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors",
                isPicked
                  ? "border-[#6457f9]/60 bg-[#6457f9]/15"
                  : "border-white/8 bg-white/[0.03] hover:bg-white/[0.07]",
                disabled && "cursor-default opacity-70",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center border",
                  q.multiSelect ? "rounded-[4px]" : "rounded-full",
                  isPicked
                    ? "border-[#6457f9] bg-[#6457f9]"
                    : "border-white/20 group-hover:border-white/40",
                )}
              >
                {isPicked && <Check className="h-2.5 w-2.5 text-white" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-white/90">{opt.label}</span>
                {opt.description && (
                  <span className="mt-0.5 block text-[10px] leading-4 text-white/40">
                    {opt.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          disabled={disabled}
          onClick={toggleOther}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors",
            otherOpen[step]
              ? "border-[#6457f9]/60 bg-[#6457f9]/15"
              : "border-white/8 bg-white/[0.03] hover:bg-white/[0.07]",
            disabled && "cursor-default opacity-70",
          )}
        >
          <span
            className={cn(
              "flex h-3.5 w-3.5 shrink-0 items-center justify-center border",
              q.multiSelect ? "rounded-[4px]" : "rounded-full",
              otherOpen[step] ? "border-[#6457f9] bg-[#6457f9]" : "border-white/20",
            )}
          >
            {otherOpen[step] && <Check className="h-2.5 w-2.5 text-white" />}
          </span>
          <span className="text-[11px] font-medium text-white/90">Other…</span>
        </button>

        {otherOpen[step] && (
          <textarea
            autoFocus
            value={other[step] ?? ""}
            onChange={(e) => setOther((prev) => ({ ...prev, [step]: e.target.value }))}
            placeholder="Your own answer…"
            disabled={disabled}
            rows={2}
            className="w-full resize-none rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2 text-[11px] text-white placeholder-white/25 outline-none focus:border-[#6457f9]/60"
          />
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-0.5">
        <div className="flex items-center gap-1">
          {questions.map((qq, i) => (
            <span
              key={`${qq.header}-${i}`}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                i === step ? "bg-[#a89dfc]" : i < step ? "bg-[#6457f9]/40" : "bg-white/15",
              )}
            />
          ))}
        </div>

        {step > 0 && (
          <button
            type="button"
            disabled={disabled}
            onClick={handleBack}
            title="Previous question"
            className="ml-1 flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-white/60 transition-colors hover:bg-white/8 hover:text-white disabled:opacity-40"
          >
            <ChevronLeft className="h-3 w-3" />
            Back
          </button>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={handleSkip}
          title="Let ArchForge decide this one — it will name the assumption"
          className="ml-auto flex h-7 items-center rounded-lg px-2 text-[11px] text-white/40 transition-colors hover:text-white/80 disabled:opacity-40"
        >
          Skip
        </button>

        <button
          type="button"
          disabled={disabled || !answerable}
          onClick={handleNext}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-[#6457f9] px-3 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {isLast ? (
            <>
              <CornerDownLeft className="h-3 w-3" />
              Send answers
            </>
          ) : (
            <>
              Next
              <ChevronRight className="h-3 w-3" />
            </>
          )}
        </button>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onDismiss}
        className="flex items-center gap-1 self-start text-[10px] text-white/25 transition-colors hover:text-white/60 disabled:opacity-40"
      >
        <Keyboard className="h-2.5 w-2.5" />
        Type my own answer instead
      </button>
    </div>
  );
}
