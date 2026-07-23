import { useState, useRef, useCallback, KeyboardEvent } from "react";
import { Bot, Send, Loader2, X, Sparkles, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_URL } from "@/lib/config";
import type { CanvasNode, CanvasEdge } from "@/types/canvas";

const STARTER_CHIPS = [
  "Design an e-commerce backend",
  "Create a real-time chat app",
  "Build a CI/CD pipeline",
  "Design a microservices system",
];

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface AiSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyDesign: (nodes: CanvasNode[], edges: CanvasEdge[]) => void;
}

export function AiSidebar({ isOpen, onClose, onApplyDesign }: AiSidebarProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "72px";
    }
    scrollToBottom();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Generation failed");

      const data = (await res.json()) as {
        nodes: CanvasNode[];
        edges: CanvasEdge[];
        summary: string;
      };

      onApplyDesign(data.nodes, data.edges);

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.summary,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      // Silently ignore user-initiated stops; only surface real failures.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const errMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Failed to generate architecture. Please try again.",
        };
        setMessages((prev) => [...prev, errMsg]);
      }
    } finally {
      abortRef.current = null;
      setIsLoading(false);
      scrollToBottom();
    }
  }, [input, isLoading, onApplyDesign, scrollToBottom]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "72px";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, []);

  const handleChip = useCallback((chip: string) => {
    setInput(chip);
    textareaRef.current?.focus();
  }, []);

  return (
    <aside
      className={cn(
        "fixed inset-y-3 right-3 top-[60px] z-40 flex w-80 flex-col rounded-2xl border border-white/10 bg-[#141414]/95 shadow-2xl backdrop-blur-xl transition-transform duration-200",
        isOpen ? "translate-x-0" : "translate-x-[calc(100%+1rem)]"
      )}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#6457f9]/20">
          <Bot className="h-4 w-4 text-[#a89dfc]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">ArchForge</p>
          <p className="text-[11px] text-white/40">Architecture assistant</p>
        </div>
        {isLoading && (
          <div className="flex items-center gap-1 rounded-full bg-[#6457f9]/20 px-2 py-0.5 text-[10px] text-[#a89dfc]">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            <span>Thinking</span>
          </div>
        )}
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/8 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-5 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#6457f9]/15">
              <Sparkles className="h-6 w-6 text-[#a89dfc]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">ArchForge Architect</p>
              <p className="mt-1.5 text-xs leading-5 text-white/40">
                Describe your system and I'll generate the architecture on the canvas for all
                collaborators to see.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2">
              {STARTER_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => handleChip(chip)}
                  className="w-full rounded-xl bg-white/5 px-4 py-2.5 text-left text-xs text-[#a89dfc] transition-colors hover:bg-white/8"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg) =>
              msg.role === "assistant" ? (
                <div key={msg.id} className="flex items-start gap-2">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#6457f9]/20">
                    <Bot className="h-3 w-3 text-[#a89dfc]" />
                  </div>
                  <div className="rounded-2xl rounded-bl-sm border border-white/8 bg-white/5 px-3.5 py-2.5 text-xs text-[#a89dfc] leading-5">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[#6457f9] px-3.5 py-2.5 text-xs font-medium text-white leading-5">
                    {msg.content}
                  </div>
                </div>
              )
            )}
            {isLoading && (
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#6457f9]/20">
                  <Bot className="h-3 w-3 text-[#a89dfc]" />
                </div>
                <div className="rounded-2xl rounded-bl-sm border border-white/8 bg-white/5 px-3.5 py-2.5">
                  <div className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#a89dfc]/60 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#a89dfc]/60 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#a89dfc]/60 [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-white/8 p-3">
        <div className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/5 p-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Describe your system…"
            disabled={isLoading}
            style={{ height: 72, maxHeight: 160, resize: "none" }}
            className="w-full bg-transparent text-sm text-white placeholder-white/25 outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/25">Shift+Enter for newline</span>
            {isLoading ? (
              <button
                onClick={handleStop}
                title="Stop generating"
                className="flex h-7 items-center gap-1.5 rounded-lg bg-red-500/90 px-3 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="flex h-7 items-center gap-1.5 rounded-lg bg-[#6457f9] px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Send className="h-3 w-3" />
                Generate
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
