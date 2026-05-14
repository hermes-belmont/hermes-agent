import { Bot } from "lucide-react";
import type { ConversationMessage } from "@/lib/types";
import { MessageActions } from "@/components/MessageActions";

export function UserMessage({ message, canEdit, onEdit }: { message: ConversationMessage; canEdit?: boolean; onEdit?: () => void }) {
  return (
    <div className="group/message relative flex justify-end">
      <div className="max-w-[88%] rounded-[24px] border border-foreground/35 bg-foreground/10 px-4 py-3">
        <MessageActions text={message.content} canEdit={canEdit} onEdit={onEdit} align="right" />
        <div className="mb-2 flex items-center justify-end gap-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          <Bot className="h-3.5 w-3.5" />
          User
        </div>
        <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{message.content}</div>
      </div>
    </div>
  );
}
