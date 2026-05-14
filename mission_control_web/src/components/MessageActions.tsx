import { Check, Copy, Edit3, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  canRegenerate?: boolean;
  canEdit?: boolean;
  onRegenerate?: () => void;
  onEdit?: () => void;
  align?: "left" | "right";
};

export function MessageActions({ text, canRegenerate, canEdit, onRegenerate, onEdit, align = "right" }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={cn(
      "absolute -top-2 flex gap-1 rounded-full border border-foreground/10 bg-background/95 p-1 opacity-0 shadow-[0_10px_26px_rgba(0,0,0,0.28)] transition-opacity group-hover/message:opacity-100 focus-within:opacity-100",
      align === "right" ? "right-2" : "left-2",
    )}>
      <button type="button" onClick={copy} title="Copy" className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-foreground/65 hover:bg-foreground/8 hover:text-foreground">
        {copied ? <Check className="h-[9px] w-[9px]" /> : <Copy className="h-[9px] w-[9px]" />}
      </button>
      {canRegenerate && (
        <button type="button" onClick={onRegenerate} title="Regenerate" className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-foreground/65 hover:bg-foreground/8 hover:text-foreground">
          <RefreshCcw className="h-[9px] w-[9px]" />
        </button>
      )}
      {canEdit && (
        <button type="button" onClick={onEdit} title="Edit" className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-foreground/65 hover:bg-foreground/8 hover:text-foreground">
          <Edit3 className="h-[9px] w-[9px]" />
        </button>
      )}
    </div>
  );
}
