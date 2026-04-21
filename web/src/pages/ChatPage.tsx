import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bot,
  Check,
  Ellipsis,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  Send,
  Trash2,
  User,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  ChatSessionMetadataItem,
  SessionInfo,
  SessionMessage,
} from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/Markdown";

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
}

type AgentState = "ready" | "processing" | "error";

const ESTIMATED_ROW_HEIGHT = 126;
const VIRTUAL_OVERSCAN_PX = 540;

function mapSessionMessage(msg: SessionMessage): ChatMessage | null {
  if (!msg.content) return null;
  return {
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp ?? Math.floor(Date.now() / 1000),
  };
}

function isNearBottom(el: HTMLDivElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

function SessionActionsMenu({
  pinned,
  onPinToggle,
  onRename,
  onDelete,
}: {
  pinned: boolean;
  onPinToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!open) return;
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Conversation actions"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="rounded p-1 text-muted-foreground hover:bg-background/70 hover:text-foreground"
      >
        <Ellipsis className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 min-w-[150px] rounded-md border border-border bg-card shadow-lg">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-secondary/30"
            onClick={(event) => {
              event.stopPropagation();
              onPinToggle();
              setOpen(false);
            }}
          >
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-secondary/30"
            onClick={(event) => {
              event.stopPropagation();
              onRename();
              setOpen(false);
            }}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Rename
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-destructive hover:bg-secondary/30"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
              setOpen(false);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionMeta, setSessionMeta] = useState<Record<string, ChatSessionMetadataItem>>({});
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  const [draftMessages, setDraftMessages] = useState<ChatMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [loadingSidebar, setLoadingSidebar] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>("ready");

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const streamViewportRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<Record<number, number>>({});

  const loadSidebarData = useCallback(async () => {
    setLoadingSidebar(true);
    try {
      const [sessionResp, metaResp] = await Promise.all([
        api.getSessions(120, 0),
        api.getChatSessionMetadata(),
      ]);
      setSessions(sessionResp.sessions);
      setSessionMeta(metaResp.items);
      if (sessionResp.sessions.length > 0 && !activeSessionId) {
        setActiveSessionId(sessionResp.sessions[0].id);
      }
    } finally {
      setLoadingSidebar(false);
    }
  }, [activeSessionId]);

  const ensureMessagesLoaded = useCallback(
    async (sessionId: string) => {
      if (messagesBySession[sessionId]) return;
      setLoadingMessages(true);
      try {
        const resp = await api.getSessionMessages(sessionId);
        const mapped = resp.messages
          .map(mapSessionMessage)
          .filter((message): message is ChatMessage => message !== null);
        setMessagesBySession((prev) => ({ ...prev, [sessionId]: mapped }));
      } finally {
        setLoadingMessages(false);
      }
    },
    [messagesBySession],
  );

  useEffect(() => {
    void loadSidebarData();
  }, [loadSidebarData]);

  useEffect(() => {
    if (!activeSessionId) return;
    void ensureMessagesLoaded(activeSessionId);
  }, [activeSessionId, ensureMessagesLoaded]);

  useLayoutEffect(() => {
    const el = streamViewportRef.current;
    if (!el) return;

    const update = () => setViewportHeight(el.clientHeight);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!composerRef.current) return;
    composerRef.current.style.height = "0px";
    composerRef.current.style.height = `${Math.min(composerRef.current.scrollHeight, 220)}px`;
  }, [input]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        composerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeMessages = activeSessionId
    ? (messagesBySession[activeSessionId] ?? [])
    : draftMessages;

  const virtualMetrics = useMemo(() => {
    const total = activeMessages.length;
    const prefix = new Array<number>(total + 1);
    prefix[0] = 0;
    for (let i = 0; i < total; i += 1) {
      prefix[i + 1] = prefix[i] + (measuredHeights[i] ?? ESTIMATED_ROW_HEIGHT);
    }

    const minY = Math.max(0, scrollTop - VIRTUAL_OVERSCAN_PX);
    const maxY = scrollTop + viewportHeight + VIRTUAL_OVERSCAN_PX;

    let start = 0;
    while (start < total && prefix[start + 1] < minY) start += 1;

    let end = start;
    while (end < total && prefix[end] < maxY) end += 1;

    return {
      start,
      end,
      topSpacer: prefix[start] ?? 0,
      bottomSpacer: (prefix[total] ?? 0) - (prefix[end] ?? 0),
      totalHeight: prefix[total] ?? 0,
    };
  }, [activeMessages.length, measuredHeights, scrollTop, viewportHeight]);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = sessions.filter((session) => {
      if (!q) return true;
      const title = (
        sessionMeta[session.id]?.custom_title
        ?? session.title
        ?? session.preview
        ?? ""
      ).toLowerCase();
      const model = (session.model ?? "").toLowerCase();
      const source = (session.source ?? "").toLowerCase();
      return title.includes(q) || model.includes(q) || source.includes(q);
    });

    return [...list].sort((a, b) => {
      const pinA = sessionMeta[a.id]?.pinned ? 1 : 0;
      const pinB = sessionMeta[b.id]?.pinned ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      return b.last_active - a.last_active;
    });
  }, [query, sessionMeta, sessions]);

  useEffect(() => {
    const viewport = streamViewportRef.current;
    if (!viewport) return;
    if (!shouldAutoScrollRef.current) return;
    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
      setScrollTop(viewport.scrollTop);
    });
  }, [activeSessionId, activeMessages.length, sending]);

  const handleNewChat = () => {
    if (sending) return;
    setActiveSessionId(null);
    setDraftMessages([]);
    setEditingSessionId(null);
    setInput("");
    setAgentState("ready");
    shouldAutoScrollRef.current = true;
    composerRef.current?.focus();
  };

  const updateSessionMeta = async (
    sessionId: string,
    patch: { pinned?: boolean; custom_title?: string | null },
  ) => {
    const resp = await api.updateChatSessionMetadata(sessionId, patch);
    setSessionMeta((prev) => ({ ...prev, [sessionId]: resp.meta }));
  };

  const handleTogglePin = async (sessionId: string) => {
    const pinned = !!sessionMeta[sessionId]?.pinned;
    await updateSessionMeta(sessionId, { pinned: !pinned });
  };

  const beginInlineRename = (session: SessionInfo) => {
    setEditingSessionId(session.id);
    setEditingTitle(
      sessionMeta[session.id]?.custom_title
      ?? session.title
      ?? "",
    );
  };

  const saveInlineRename = async (sessionId: string) => {
    const value = editingTitle.trim();
    await updateSessionMeta(sessionId, { custom_title: value || null });
    setEditingSessionId(null);
    setEditingTitle("");
  };

  const handleDeleteSession = async (sessionId: string) => {
    await api.deleteSession(sessionId);
    setSessions((prev) => prev.filter((session) => session.id !== sessionId));
    setMessagesBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setSessionMeta((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });

    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setDraftMessages([]);
    }
  };

  const appendDeltaToActiveAssistant = (sessionId: string | null, delta: string) => {
    if (!delta) return;

    const applyDelta = (messages: ChatMessage[]): ChatMessage[] => {
      if (messages.length === 0) return messages;
      const next = [...messages];
      const idx = next.length - 1;
      if (next[idx].role !== "assistant") return next;
      next[idx] = { ...next[idx], content: next[idx].content + delta };
      return next;
    };

    if (sessionId) {
      setMessagesBySession((prev) => ({
        ...prev,
        [sessionId]: applyDelta(prev[sessionId] ?? []),
      }));
      return;
    }

    setDraftMessages((prev) => applyDelta(prev));
  };

  const finalizeAssistantMessage = (
    sessionId: string | null,
    finalContent: string,
  ) => {
    const applyFinal = (messages: ChatMessage[]): ChatMessage[] => {
      if (messages.length === 0) return messages;
      const next = [...messages];
      const idx = next.length - 1;
      if (next[idx].role !== "assistant") return next;
      next[idx] = { ...next[idx], content: finalContent };
      return next;
    };

    if (sessionId) {
      setMessagesBySession((prev) => ({
        ...prev,
        [sessionId]: applyFinal(prev[sessionId] ?? []),
      }));
      return;
    }

    setDraftMessages((prev) => applyFinal(prev));
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || sending) return;

    const targetSessionId = activeSessionId;
    const now = Math.floor(Date.now() / 1000);
    const userMessage: ChatMessage = { role: "user", content, timestamp: now };
    const assistantPlaceholder: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: now,
    };

    let draftBaseBeforeSend: ChatMessage[] = [];

    if (targetSessionId) {
      setMessagesBySession((prev) => ({
        ...prev,
        [targetSessionId]: [
          ...(prev[targetSessionId] ?? []),
          userMessage,
          assistantPlaceholder,
        ],
      }));
    } else {
      draftBaseBeforeSend = draftMessages;
      setDraftMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    }

    setInput("");
    setSending(true);
    setAgentState("processing");

    let streamedContent = "";

    try {
      const result = await api.sendChatStream(
        {
          session_id: targetSessionId,
          message: { role: "user", content },
        },
        {
          onDelta: (delta) => {
            streamedContent += delta;
            appendDeltaToActiveAssistant(targetSessionId, delta);
          },
          onStatus: (status) => {
            if (status === "completed") {
              setAgentState("ready");
            }
          },
        },
      );

      const finalText = result.reply.content || streamedContent || "(empty response)";

      if (targetSessionId) {
        finalizeAssistantMessage(targetSessionId, finalText);
      } else {
        const persistedId = result.session_id;
        const nextMessages = [...draftBaseBeforeSend, userMessage, {
          ...assistantPlaceholder,
          content: finalText,
        }];
        setMessagesBySession((prev) => ({ ...prev, [persistedId]: nextMessages }));
        setDraftMessages([]);
        setActiveSessionId(persistedId);
      }

      await loadSidebarData();
      setAgentState("ready");
    } catch {
      const fallback = streamedContent || "(stream failed)";
      finalizeAssistantMessage(targetSessionId, fallback);
      setAgentState("error");
    } finally {
      setSending(false);
      composerRef.current?.focus();
    }
  };

  const displayedStatusText =
    agentState === "processing"
      ? "Processing"
      : agentState === "error"
        ? "Degraded"
        : "Ready";

  return (
    <div className="h-[calc(100vh-8.5rem)] min-h-[620px] rounded-lg border border-border/70 bg-card/50 overflow-hidden">
      <div className="flex h-full">
        <aside
          className={`${sidebarCollapsed ? "w-0 md:w-14" : "w-[320px]"} border-r border-border/70 bg-background/80 transition-all duration-200 shrink-0`}
        >
          {sidebarCollapsed ? (
            <div className="hidden h-full md:flex md:flex-col md:items-center md:py-3 md:gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Expand sidebar"
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Start new chat"
                onClick={handleNewChat}
                disabled={sending}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-border/70 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-display text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    Conversations
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="New chat"
                      onClick={handleNewChat}
                      disabled={sending}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden h-8 w-8 md:inline-flex"
                      aria-label="Collapse sidebar"
                      onClick={() => setSidebarCollapsed(true)}
                    >
                      <PanelLeftClose className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search recents"
                  className="h-8"
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {loadingSidebar ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : filteredSessions.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground px-3">
                    <MessageSquare className="h-5 w-5" />
                    <p className="text-xs">No conversations yet.</p>
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {filteredSessions.map((session) => {
                      const isActive = activeSessionId === session.id;
                      const pinned = !!sessionMeta[session.id]?.pinned;
                      const title =
                        sessionMeta[session.id]?.custom_title
                        ?? session.title
                        ?? session.preview
                        ?? "Untitled";

                      const editing = editingSessionId === session.id;

                      return (
                        <li key={session.id}>
                          <button
                            type="button"
                            onClick={() => {
                              if (sending) return;
                              setEditingSessionId(null);
                              setActiveSessionId(session.id);
                            }}
                            className={`group w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                              isActive
                                ? "border-primary/30 bg-primary/10"
                                : "border-transparent hover:border-border hover:bg-secondary/30"
                            }`}
                          >
                            <div className="mb-1 flex items-start justify-between gap-2">
                              {editing ? (
                                <div className="flex min-w-0 flex-1 items-center gap-1">
                                  <Input
                                    value={editingTitle}
                                    onChange={(event) => setEditingTitle(event.target.value)}
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void saveInlineRename(session.id);
                                      }
                                      if (event.key === "Escape") {
                                        event.preventDefault();
                                        setEditingSessionId(null);
                                      }
                                    }}
                                    className="h-7 text-xs"
                                  />
                                  <button
                                    type="button"
                                    className="rounded p-1 text-muted-foreground hover:bg-background/70 hover:text-foreground"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void saveInlineRename(session.id);
                                    }}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded p-1 text-muted-foreground hover:bg-background/70 hover:text-foreground"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setEditingSessionId(null);
                                    }}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <span className="line-clamp-2 text-sm leading-tight text-foreground">
                                    {title}
                                  </span>
                                  <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                    <SessionActionsMenu
                                      pinned={pinned}
                                      onPinToggle={() => {
                                        void handleTogglePin(session.id);
                                      }}
                                      onRename={() => beginInlineRename(session)}
                                      onDelete={() => {
                                        void handleDeleteSession(session.id);
                                      }}
                                    />
                                  </div>
                                </>
                              )}
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              <span className="truncate max-w-[130px]">
                                {(session.model ?? "local").split("/").pop()}
                              </span>
                              <div className="inline-flex items-center gap-2">
                                {pinned && <Pin className="h-3 w-3" />}
                                <span>{timeAgo(session.last_active)}</span>
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-background/70">
          <header className="flex h-12 items-center justify-between border-b border-border/70 px-3 sm:px-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 md:hidden"
                aria-label="Toggle sidebar"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
              <span className="font-display text-sm uppercase tracking-[0.15em] text-muted-foreground">
                Hermes Agent
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span
                  className={`h-2 w-2 rounded-full ${
                    agentState === "processing"
                      ? "bg-warning animate-pulse"
                      : agentState === "error"
                        ? "bg-destructive"
                        : "bg-success"
                  }`}
                />
                {displayedStatusText}
              </span>
              <span className="hidden sm:inline text-muted-foreground">
                {activeSessionId ? "Persistent Session" : "New Session"}
              </span>
            </div>
          </header>

          <div
            ref={streamViewportRef}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6"
            onScroll={(event) => {
              const viewport = event.currentTarget;
              setScrollTop(viewport.scrollTop);
              shouldAutoScrollRef.current = isNearBottom(viewport);
            }}
          >
            {loadingMessages ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : activeMessages.length === 0 ? (
              <div className="mx-auto mt-12 max-w-xl text-center">
                <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card/80">
                  <Bot className="h-6 w-6" />
                </div>
                <h2 className="mb-2 text-lg">Agent Console</h2>
                <p className="text-sm text-muted-foreground">
                  Ask Hermes for analysis, execution, or workflows. Enter sends. Shift+Enter adds a new line.
                </p>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl" style={{ minHeight: Math.max(virtualMetrics.totalHeight, viewportHeight) }}>
                <div style={{ height: virtualMetrics.topSpacer }} />

                <div className="flex flex-col gap-4">
                  {activeMessages
                    .slice(virtualMetrics.start, virtualMetrics.end)
                    .map((message, localIdx) => {
                      const absoluteIdx = virtualMetrics.start + localIdx;
                      const isUser = message.role === "user";

                      return (
                        <div
                          key={`${message.timestamp}-${absoluteIdx}-${message.role}`}
                          ref={(node) => {
                            if (!node) return;
                            const measured = Math.round(node.getBoundingClientRect().height);
                            if (!measured) return;
                            const prev = measuredHeights[absoluteIdx];
                            if (prev === measured) return;
                            setMeasuredHeights((current) => ({ ...current, [absoluteIdx]: measured }));
                          }}
                          className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[90%] rounded-2xl border px-4 py-3 sm:max-w-[82%] ${
                              isUser
                                ? "border-primary/30 bg-primary/10"
                                : "border-border bg-card/70"
                            }`}
                          >
                            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                              {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                              <span>{isUser ? "You" : "Hermes Agent"}</span>
                              <span>•</span>
                              <span>{timeAgo(message.timestamp)}</span>
                            </div>
                            {isUser ? (
                              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                                {message.content}
                              </p>
                            ) : (
                              <Markdown content={message.content || ""} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>

                <div style={{ height: virtualMetrics.bottomSpacer }} />
              </div>
            )}
          </div>

          <div className="border-t border-border/70 bg-background/90 p-3 sm:p-4">
            <div className="mx-auto max-w-3xl">
              <form
                className="relative"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSend();
                }}
              >
                <textarea
                  ref={composerRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  rows={1}
                  placeholder="Message Hermes Agent…"
                  className="w-full resize-none rounded-xl border border-border bg-card/70 py-3 pl-3 pr-12 text-sm leading-relaxed outline-none transition-colors focus:border-primary/40"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  aria-label="Send"
                  className="absolute bottom-2.5 right-2.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary/80 text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </form>
              <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
                <span>Enter to send • Shift+Enter for newline • Cmd/Ctrl+K to focus</span>
                <span>{activeMessages.length} msgs</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
