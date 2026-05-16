import { useCallback, useRef, useState } from "react";
import type { AgentRecord, BootstrapResponse, ChatAttachment, InlineToolEvent } from "@/lib/types";

declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string;
    __MC_DEBUG_STREAM?: boolean;
  }
}

type StreamRequest = {
  agent_id: string;
  conversation_id: string;
  message: { role: "user"; content: string };
  attachments?: ChatAttachment[];
  model?: string;
};

type StreamResult = {
  conversation_id: string;
  session_id: string;
  reply: { role: string; content: string };
  conversation: { id: string; title: string };
  agent: AgentRecord;
  summary: BootstrapResponse["summary"];
};

type StreamHandlers = {
  onDelta?: (text: string) => void;
  onStatus?: (status: string) => void;
  onTool?: (tool: InlineToolEvent) => void;
  onConversation?: (conversationId: string) => void;
};

async function getSessionToken(): Promise<string | undefined> {
  if (window.__HERMES_SESSION_TOKEN__) return window.__HERMES_SESSION_TOKEN__;
  try {
    const response = await fetch("/__hermes/session-token", { headers: { Accept: "application/json" } });
    if (!response.ok) return undefined;
    const payload = await response.json() as { token?: string };
    if (payload.token) window.__HERMES_SESSION_TOKEN__ = payload.token;
    return payload.token;
  } catch {
    return undefined;
  }
}

function debugStream(event: string, payload: unknown) {
  if (window.__MC_DEBUG_STREAM) {
    console.debug("[mission-control stream]", event, payload);
  }
}

function parseToolEvent(event: string, payload: unknown): InlineToolEvent | null {
  if (!event.includes("tool") && !event.includes("function")) return null;
  const value = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const name = String(value.name ?? value.tool_name ?? value.function_name ?? value.tool ?? "tool");
  const statusValue = String(value.status ?? (event.includes("error") ? "error" : event.includes("done") || event.includes("result") ? "done" : "running"));
  const status = statusValue === "error" ? "error" : statusValue === "done" || statusValue === "completed" || statusValue === "success" ? "done" : "running";
  return {
    id: String(value.id ?? value.call_id ?? `${name}-${Date.now()}`),
    name,
    status,
    input: value.input ?? value.arguments ?? value.args,
    output: value.output ?? value.result,
    duration_ms: typeof value.duration_ms === "number" ? value.duration_ms : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (body: StreamRequest, handlers: StreamHandlers = {}): Promise<StreamResult> => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setIsStreaming(true);

    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      const token = await getSessionToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);

      const response = await fetch("/api/mission-control/chat/stream", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`${response.status}: ${text}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: StreamResult | null = null;

      const flushBlock = (rawBlock: string) => {
        const block = rawBlock.trim();
        if (!block) return;
        const lines = block.split("\n");
        let event = "message";
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }

        const rawData = dataLines.join("\n");
        if (!rawData) return;

        let payload: unknown = rawData;
        try {
          payload = JSON.parse(rawData);
        } catch {
          payload = rawData;
        }
        debugStream(event, payload);

        const tool = parseToolEvent(event, payload);
        if (tool) {
          handlers.onTool?.(tool);
          return;
        }

        if (event === "delta") {
          const value = (typeof payload === "object" && payload !== null ? payload : {}) as { text?: string; content?: string; delta?: string };
          const text = typeof payload === "string" ? payload : value.text ?? value.content ?? value.delta ?? "";
          if (text) handlers.onDelta?.(text);
          return;
        }

        if (event === "status") {
          const status = typeof payload === "string" ? payload : ((payload as { status?: string })?.status ?? "");
          if (status) handlers.onStatus?.(status);
          return;
        }

        if (event === "conversation") {
          const conversationId = typeof payload === "object" && payload !== null ? (payload as { conversation_id?: string }).conversation_id : undefined;
          if (conversationId) handlers.onConversation?.(conversationId);
          return;
        }

        if (event === "done") {
          finalResult = payload as StreamResult;
          return;
        }

        if (event === "error") {
          const message = typeof payload === "string"
            ? payload
            : (payload as { detail?: string; message?: string })?.detail ?? (payload as { detail?: string; message?: string })?.message ?? "stream error";
          throw new Error(message);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf("\n\n");
        while (idx >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          flushBlock(block);
          idx = buffer.indexOf("\n\n");
        }
      }

      if (buffer.trim()) flushBlock(buffer);
      if (!finalResult) throw new Error("Stream ended without completion event");
      return finalResult;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  return { send, abort, isStreaming };
}
