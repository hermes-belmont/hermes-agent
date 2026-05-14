(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  const { React, useState, useEffect, useRef } = SDK;
  const { Card, CardHeader, CardTitle, CardContent, Badge, Button, Input, Label, Separator, Tabs, Tab } = SDK.components;
  const { cn } = SDK.utils;

  function ChatTab() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [activeTab, setActiveTab] = useState(0);
    const messagesEndRef = useRef(null);

    // Simulate initial greeting
    useEffect(() => {
      const initialMessages = [
        { role: "system", content: "You are chatting with Hermes Agent. I can help you with tasks, coding, research, and more." },
        { role: "assistant", content: "Hello! I'm Hermes, your AI assistant. How can I help you today?" }
      ];
      setMessages(initialMessages);
    }, []);

    const scrollToBottom = () => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
      }
    };

    useEffect(() => {
      scrollToBottom();
    }, [messages]);

    const handleSend = () => {
      if (!input.trim()) return;

      const userMessage = {
        role: "user",
        content: input,
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, userMessage]);
      setInput("");

      // Simulate agent response
      setTimeout(() => {
        const responses = [
          "I'm thinking about that...",
          "That's an interesting question.",
          "Let me check on that for you.",
          "I'll need to look into that.",
          "One moment please."
        ];
        const randomResponse = responses[Math.floor(Math.random() * responses.length)];
        setMessages(prev => [...prev, { role: "assistant", content: randomResponse }]);
      }, 1000 + Math.random() * 2000);
    };

    const handleKeyPress = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    };

    const renderMessage = (message, index) => {
      const isUser = message.role === "user";
      const isSystem = message.role === "system";
      const isAssistant = message.role === "assistant";

      return (
        <div key={index} className={cn(
          "mb-4 p-3 rounded-lg",
          isUser && "bg-blue-50 border border-blue-100 self-end",
          isAssistant && "bg-white border border-gray-100",
          isSystem && "bg-gray-50 border border-gray-100 text-sm text-gray-600 italic"
        )}>
          <div className={cn(
            "flex items-start gap-2",
            isUser && "justify-end",
            isAssistant && "justify-start",
            isSystem && "justify-start"
          )}>
            {isUser && (
              <div className="text-blue-600 font-medium">You</div>
            )}
            {isAssistant && (
              <div className="text-green-600 font-medium">Hermes</div>
            )}
            {isSystem && (
              <div className="text-gray-500 font-medium">System</div>
            )}
            <div className="flex-1">
              <div className="whitespace-pre-wrap">{message.content}</div>
              {!isSystem && (
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="flex flex-col gap-6 h-full">
        {/* Header Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">Chat with Hermes</CardTitle>
              <Badge variant="outline">Real-time</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Direct chat interface with Hermes Agent. Ask questions, get help with tasks, or just have a conversation.
            </p>
          </CardHeader>
        </Card>

        {/* Chat History */}
        <Card className="flex-1 overflow-hidden flex flex-col">
          <CardHeader>
            <CardTitle className="text-base">Conversation</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-0">
            <div className="p-4 space-y-4">
              {messages.map(renderMessage)}
              <div ref={messagesEndRef} />
            </div>
          </CardContent>
        </Card>

        {/* Input Area */}
        <Card>
          <CardHeader>
            <Label htmlFor="chat-input">Your Message</Label>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type your message here..."
              className="flex-1"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Send
            </Button>
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Hermes is ready to help with:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Programming and code review</li>
              <li>Research and information synthesis</li>
              <li>Task automation and planning</li>
              <li>Creative writing and ideation</li>
              <li>Mathematical and analytical reasoning</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Register this plugin — the dashboard picks it up automatically.
  window.__HERMES_PLUGINS__.register("chat", ChatTab);
})();