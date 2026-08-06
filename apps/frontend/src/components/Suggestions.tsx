import { ArrowRight } from "lucide-react";
import type { Suggestion } from "@/types/canvas";

interface SuggestionsProps {
  suggestions: Suggestion[];
  disabled: boolean;
  /** Re-enters send() as an ordinary user turn — the same channel the question card uses,
   * which is why the label is sent verbatim and never reformatted here. */
  onSubmit: (text: string) => void;
}

/**
 * The AI's proposed next moves, as one-click chips. Rendered only under the newest message:
 * a chip proposed three turns ago would execute against a canvas that has since moved on.
 */
export function Suggestions({ suggestions, disabled, onSubmit }: SuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-1">
      <span className="px-1 text-[10px] font-medium text-white/25">Suggested next</span>
      {suggestions.map((s) => (
        <button
          key={s.label}
          type="button"
          disabled={disabled}
          onClick={() => onSubmit(s.label)}
          title={s.rationale || undefined}
          className="group flex w-full items-start gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07] disabled:cursor-default disabled:opacity-50"
        >
          <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-[#a89dfc]/60 transition-colors group-hover:text-[#a89dfc]" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium text-white/90">{s.label}</span>
            {s.rationale && (
              <span className="mt-0.5 block text-[10px] leading-4 text-white/40">
                {s.rationale}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
