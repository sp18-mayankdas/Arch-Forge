import { useState, useRef, useCallback, KeyboardEvent } from "react";
import { Bot, Send, Loader2, X, Sparkles, Square, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_URL } from "@/lib/config";
import type {
  SemanticNode,
  SemanticEdge,
  SerializedGraph,
  ChatMessage,
  GenerateRequest,
  GenerateResponse,
} from "@/types/canvas";
import { toChatHistory } from "@/lib/ai-history";
import { ClarifyQuestions } from "./ClarifyQuestions";
import { ThinkingBlock } from "./ThinkingBlock";
import { Suggestions } from "./Suggestions";

const STARTER_CHIPS = [
  "Design an e-commerce backend",
  "Create a real-time chat app",
  "Build a CI/CD pipeline",
  "Design a microservices system",
];

interface AiSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  /** Returns whether the canvas actually changed — a large removal waits for confirmation,
   * and the "Canvas updated" pill must not claim an update that has not happened. */
  onApplyDesign: (nodes: SemanticNode[], edges: SemanticEdge[]) => boolean;
  /** Reads the live canvas as topology-only, so the AI can amend it rather than
   * redesigning blind — which is what made "simplify this" grow the diagram. */
  readGraphForAi: () => SerializedGraph;
  /** The transcript lives in the Yjs doc, not in local state, so it is shared across the
   * room and survives a reload. This component renders it and appends to it; it does not
   * own it. Every field a turn renders is on ChatMessage for that reason. */
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  /** False until the room's history has arrived, so a reload shows a loader instead of
   * flashing the empty state over a transcript that is about to appear. */
  synced: boolean;
}

export function AiSidebar({
  isOpen,
  onClose,
  onApplyDesign,
  readGraphForAi,
  messages,
  addMessage,
  synced,
}: AiSidebarProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
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

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || isLoading) return;

      const userMsg: ChatMessage = {
        // Timestamp alone collided as a React key when chips were clicked in quick succession.
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "user",
        content,
      };

      // The transcript is the request. Capture it here rather than reading `messages`
      // inside the async body, where it would be a stale closure.
      const history = toChatHistory([...messages, userMsg]);
      const nodeCountBefore = readGraphForAi().nodes.length;

      addMessage(userMsg);
      setIsLoading(true);
      scrollToBottom();

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`${API_URL}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Full conversation, not a lone prompt: a clarifying question is only
          // answerable if the model can see what it already asked. The graph goes too,
          // so an edit amends what is on screen instead of designing blind.
          body: JSON.stringify({
            messages: history,
            graph: readGraphForAi(),
          } satisfies GenerateRequest),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error("Generation failed");

        const data = (await res.json()) as GenerateResponse;

        // `applied` distinguishes a design from a conversational turn. An empty node list
        // cannot: "remove everything" is itself a legitimate edit. The canvas may still
        // decline the write (large removals wait for confirmation), so trust its answer over
        // the server's intent.
        const changed = data.applied ? onApplyDesign(data.nodes, data.edges) : false;

        const assistantMsg: ChatMessage = {
          id: `${Date.now() + 1}-${Math.random().toString(36).slice(2, 7)}`,
          role: "assistant",
          content: data.summary,
          thinking: data.thinking,
          // `?? []` despite the type: GenerateResponse is what the server PROMISES, and the
          // cast above is a claim rather than a check. A tab holding a new bundle against a
          // not-yet-deployed backend lands here with undefined.
          questions: data.questions?.length ? data.questions : undefined,
          suggestions: data.suggestions?.length ? data.suggestions : undefined,
          tradeoff: data.tradeoff,
          // Net change, so a removal is visible. Silently shrinking someone's canvas is
          // alarming; saying "−4" is not.
          change: changed
            ? { total: data.nodes.length, delta: data.nodes.length - nodeCountBefore }
            : undefined,
        };
        addMessage(assistantMsg);
      } catch (err) {
        // Silently ignore user-initiated stops; only surface real failures.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          const errMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: "Failed to generate architecture. Please try again.",
          };
          addMessage(errMsg);
        }
      } finally {
        abortRef.current = null;
        setIsLoading(false);
        scrollToBottom();
      }
    },
    [messages, isLoading, onApplyDesign, readGraphForAi, scrollToBottom, addMessage]
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "72px";
    }
    send(text);
  }, [input, isLoading, send]);

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
        {messages.length === 0 && !synced ? (
          // Room history still syncing — show a loader, not the empty state, to
          // avoid flashing the starter UI before existing chat loads on reload.
          <div className="flex h-full items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-white/25" />
          </div>
        ) : messages.length === 0 ? (
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
            {messages.map((msg, i) =>
              msg.role === "assistant" ? (
                <div key={msg.id} className="flex items-start gap-2">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#6457f9]/20">
                    <Bot className="h-3 w-3 text-[#a89dfc]" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                    {msg.thinking && <ThinkingBlock thinking={msg.thinking} />}
                    <div className="rounded-2xl rounded-bl-sm border border-white/8 bg-white/5 px-3.5 py-2.5 text-xs text-[#a89dfc] leading-5">
                      {msg.content}
                    </div>
                    {msg.tradeoff && (
                      <p className="flex gap-1.5 border-l-2 border-amber-400/30 pl-2 text-[10px] leading-4 text-white/45">
                        <TriangleAlert className="mt-0.5 h-2.5 w-2.5 shrink-0 text-amber-400/60" />
                        <span>{msg.tradeoff}</span>
                      </p>
                    )}
                    {msg.questions?.length ? (
                      <ClarifyQuestions
                        questions={msg.questions}
                        // Only the newest round is answerable; earlier rounds are a record.
                        active={i === messages.length - 1}
                        disabled={isLoading}
                        onSubmit={send}
                      />
                    ) : null}
                    {msg.change && (
                      <span className="rounded-full bg-[#6457f9]/15 px-2 py-0.5 text-[10px] text-[#a89dfc]">
                        Canvas updated · {msg.change.total} nodes
                        {msg.change.delta !== 0 &&
                          ` (${msg.change.delta > 0 ? "+" : "−"}${Math.abs(msg.change.delta)})`}
                      </span>
                    )}
                    {/* Newest message only — a chip from three turns ago would run against a
                        canvas that has since moved on. */}
                    {msg.suggestions?.length && i === messages.length - 1 ? (
                      <Suggestions
                        suggestions={msg.suggestions}
                        disabled={isLoading}
                        onSubmit={send}
                      />
                    ) : null}
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
