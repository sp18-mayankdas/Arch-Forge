import { Handle, Position, NodeResizer } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { CanvasNode, NodeShape, NodeType } from "@/types/canvas";
import { NODE_COLORS, NODE_TYPE_REGISTRY } from "@/types/canvas";

const BORDER_REST = "rgba(255,255,255,0.1)";
const BORDER_SELECTED = "rgba(255,255,255,0.4)";
const RESIZER_COLOR = "rgba(255,255,255,0.3)";

const HANDLE_CLS =
  "!h-2.5 !w-2.5 !rounded-full !border-2 !border-[#0e0e0e] !bg-white opacity-0 transition-opacity group-hover/node:opacity-100";

const RESIZER_HANDLE_STYLE: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.55)",
  border: "1px solid rgba(255,255,255,0.2)",
};

const RESIZER_LINE_STYLE: React.CSSProperties = {
  borderColor: RESIZER_COLOR,
  borderWidth: 1,
};

function DiamondSvg({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polygon points="50,0 100,50 50,100 0,50" fill={fill} stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

function HexagonSvg({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polygon
        points="25,0 75,0 100,50 75,100 25,100 0,50"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
      />
    </svg>
  );
}

function CylinderSvg({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <rect x="0" y="15" width="100" height="70" fill={fill} />
      <line x1="0" y1="15" x2="0" y2="85" stroke={stroke} strokeWidth="1.5" />
      <line x1="100" y1="15" x2="100" y2="85" stroke={stroke} strokeWidth="1.5" />
      <ellipse cx="50" cy="85" rx="50" ry="15" fill={fill} stroke={stroke} strokeWidth="1.5" />
      <ellipse cx="50" cy="15" rx="50" ry="15" fill={fill} stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

function borderRadius(shape: NodeShape): string {
  if (shape === "pill") return "9999px";
  if (shape === "circle") return "50%";
  return "10px";
}

export function CanvasNodeComponent({ id, data, selected }: NodeProps<CanvasNode>) {
  // Shape and colour are derived from the node's semantic type, never stored on the
  // node. The registry is the single source of rendering truth.
  const spec = NODE_TYPE_REGISTRY[data.type as NodeType] ?? NODE_TYPE_REGISTRY.service;
  const palette = NODE_COLORS[spec.colorIndex];
  const fill = palette.fill;
  const textColor = palette.text;
  const shape: NodeShape = spec.shape;
  const stroke = selected ? BORDER_SELECTED : BORDER_REST;
  const isSvg = shape === "diamond" || shape === "hexagon" || shape === "cylinder";

  const label = (
    <span
      className={isSvg ? "relative z-10 truncate px-3 text-center" : "truncate px-3 text-center"}
      style={{ color: textColor, fontSize: 13, fontWeight: 500 }}
    >
      {data.label || <span style={{ opacity: 0.35 }}>{spec.defaultLabel}</span>}
    </span>
  );

  return (
    <div
      className="group/node relative flex h-full w-full items-center justify-center"
      data-node-id={id}
    >
      <NodeResizer
        isVisible={selected ?? false}
        color={RESIZER_COLOR}
        minWidth={60}
        minHeight={40}
        handleStyle={RESIZER_HANDLE_STYLE}
        lineStyle={RESIZER_LINE_STYLE}
      />

      {isSvg ? (
        <>
          <div className="absolute inset-0">
            {shape === "diamond" && <DiamondSvg fill={fill} stroke={stroke} />}
            {shape === "hexagon" && <HexagonSvg fill={fill} stroke={stroke} />}
            {shape === "cylinder" && <CylinderSvg fill={fill} stroke={stroke} />}
          </div>
          {label}
        </>
      ) : (
        <div
          style={{
            background: fill,
            borderRadius: borderRadius(shape),
            border: `1px solid ${stroke}`,
            width: "100%",
            height: "100%",
          }}
          className="flex items-center justify-center"
        >
          {label}
        </div>
      )}

      <Handle id="top" type="source" position={Position.Top} className={HANDLE_CLS} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={HANDLE_CLS} />
      <Handle id="left" type="source" position={Position.Left} className={HANDLE_CLS} />
      <Handle id="right" type="source" position={Position.Right} className={HANDLE_CLS} />
    </div>
  );
}
