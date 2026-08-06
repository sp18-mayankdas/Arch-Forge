import { useState } from "react";
import { ChevronRight, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The model's reasoning for a turn. Collapsed by default — it explains a decision the user
 * did not ask to see, so it should be available without competing with the answer.
 */
export function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-[10px] text-white/30 transition-colors hover:text-white/60"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        <Brain className="h-3 w-3" />
        {open ? "Hide reasoning" : "Thought about this"}
      </button>
      {open && (
        <p className="mt-1 border-l border-white/10 pl-2.5 text-[10px] leading-4 text-white/40">
          {thinking}
        </p>
      )}
    </div>
  );
}
