import { BrainCircuit } from "lucide-react";
import type { ConversationMessage } from "@/lib/types";
import { InlineToolChip, ToolEmptyState } from "@/components/InlineToolChip";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { MessageActions } from "@/components/MessageActions";
import { StreamingIndicator } from "@/components/StreamingIndicator";
import { cn } from "@/lib/utils";

export function AssistantMessage({
  message,
  isLatestAssistant,
  onRegenerate,
  onRetry,
}: {
  message: ConversationMessage;
  isLatestAssistant?: boolean;
  onRegenerate?: () => void;
  onRetry?: () => void;
}) {
  const isThinking = message.client_status === "thinking" && !message.content;
  const isStreaming = message.client_status === "streaming";
  const isError = message.client_status === "error";
  const tools = message.tool_events ?? [];

  return (
    <div className="group/message relative flex justify-start">
      <div
        role={isError ? "button" : undefined}
        tabIndex={isError ? 0 : undefined}
        onClick={isError ? onRetry : undefined}
        onKeyDown={(event) => {
          if (isError && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onRetry?.();
          }
        }}
        className={cn(
          "max-w-[88%] rounded-[24px] border px-4 py-3",
          isError
            ? "cursor-pointer border-[rgba(251,44,54,0.35)] bg-[rgba(251,44,54,0.08)] text-[rgb(255,180,184)]"
            : "border-border bg-card/80",
        )}
      >
        <MessageActions text={message.content} canRegenerate={isLatestAssistant && !isStreaming && !isThinking} onRegenerate={onRegenerate} align="left" />
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          <BrainCircuit className="h-3.5 w-3.5" />
          Assistant
        </div>
        {isThinking ? (
          <StreamingIndicator />
        ) : isError ? (
          <div className="text-sm leading-6">Stream interrupted. Tap to retry.</div>
        ) : (
          <>
            {tools.map((tool) => <InlineToolChip key={tool.id} tool={tool} />)}
            {message.content ? <MarkdownRenderer content={message.content} /> : <StreamingIndicator />}
            {isStreaming && <span className="ml-1 inline-block h-4 w-px animate-pulse translate-y-0.5 bg-[var(--warm-glow)]" aria-hidden />}
            {!isStreaming && tools.length === 0 && <ToolEmptyState />}
          </>
        )}
      </div>
    </div>
  );
}
