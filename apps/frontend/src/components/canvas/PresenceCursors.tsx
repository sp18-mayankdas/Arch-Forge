import { useStore } from "@xyflow/react";
import type { UserAwareness } from "@/types/canvas";

interface Props {
  collaborators: UserAwareness[];
}

export function PresenceCursors({ collaborators }: Props) {
  const transform = useStore((s) => s.transform);

  const active = collaborators.filter((c) => c.cursor !== null);
  if (!active.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {active.map((c) => {
        if (!c.cursor) return null;
        const x = c.cursor.x * transform[2] + transform[0];
        const y = c.cursor.y * transform[2] + transform[1];

        return (
          <div
            key={c.userId}
            className="absolute"
            style={{ left: x, top: y, transform: "translate(-4px, -4px)" }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M4 2L17 10L11 12L8 18L4 2Z"
                fill={c.color}
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="1"
              />
            </svg>
            <div
              className="mt-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white whitespace-nowrap"
              style={{ background: c.color }}
            >
              {c.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
