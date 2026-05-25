import { useEffect, useState, type RefObject } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type ScrollToBottomButtonProps = {
  scrollContainerRef?: RefObject<HTMLElement | null>;
  getScrollElement?: () => HTMLElement | null;
  threshold?: number;
  className?: string;
};

export function ScrollToBottomButton({
  scrollContainerRef,
  getScrollElement,
  threshold = 100,
  className,
}: ScrollToBottomButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scrollElement = getScrollElement?.() ?? scrollContainerRef?.current ?? null;
    if (!scrollElement) {
      setVisible(false);
      return;
    }

    const updateVisibility = () => {
      const distanceFromBottom = scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
      setVisible(distanceFromBottom > threshold);
    };

    updateVisibility();
    scrollElement.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);

    return () => {
      scrollElement.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, [getScrollElement, scrollContainerRef, threshold]);

  const scrollToBottom = () => {
    const scrollElement = getScrollElement?.() ?? scrollContainerRef?.current ?? null;
    scrollElement?.scrollTo({ top: scrollElement.scrollHeight, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      aria-label="Scroll to bottom"
      onClick={scrollToBottom}
      className={cn(
        "absolute bottom-6 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-foreground/10 bg-background/88 text-foreground/82 shadow-[0_14px_44px_rgba(0,0,0,0.34)] backdrop-blur-xl transition duration-200 hover:border-[color-mix(in_srgb,var(--warm-glow)_42%,transparent)] hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--warm-glow)_55%,transparent)]",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        className,
      )}
    >
      <ChevronDown className="h-4 w-4" />
    </button>
  );
}
