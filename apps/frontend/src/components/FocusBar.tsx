import { Crosshair, X } from "lucide-react";
import type { FocusRef } from "@/types/canvas";

interface FocusBarProps {
  refs: FocusRef[];
  onUnfocus: (id: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

/**
 * The marked nodes, shown above the composer.
 *
 * Focus is sticky — it survives a turn, which is what lets the answer to a clarifying question
 * carry the same scope as the question. That stickiness is only acceptable because the scope is
 * never invisible: this bar is on screen the whole time it is set, and offers three ways out
 * (one chip, all chips, or Escape on the canvas).
 */
export function FocusBar({ refs, onUnfocus, onClear, disabled }: FocusBarProps) {
  if (refs.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      <span className="flex items-center gap-1 pr-0.5 text-[10px] text-white/25">
        <Crosshair className="h-2.5 w-2.5 text-[#a89dfc]/70" />
        Focused
      </span>
      {/* Capped height so a ten-node focus scrolls instead of eating the composer. */}
      <div className="flex max-h-16 flex-1 flex-wrap items-center gap-1 overflow-y-auto">
        {refs.map((ref) => (
          <span
            key={ref.id}
            title={ref.label}
            className="flex max-w-[140px] items-center gap-1 rounded-full border border-[#6457f9]/30 bg-[#6457f9]/15 py-0.5 pl-2 pr-1 text-[10px] text-[#a89dfc]"
          >
            <span className="truncate">{ref.label}</span>
            <button
              onClick={() => onUnfocus(ref.id)}
              disabled={disabled}
              title={`Stop focusing ${ref.label}`}
              aria-label={`Stop focusing ${ref.label}`}
              className="shrink-0 rounded-full p-0.5 text-[#a89dfc]/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      <button
        onClick={onClear}
        disabled={disabled}
        className="shrink-0 rounded px-1 text-[10px] text-white/30 transition-colors hover:text-white/70 disabled:opacity-40"
      >
        Clear
      </button>
    </div>
  );
}
