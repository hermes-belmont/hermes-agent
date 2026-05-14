import { useEffect, useState } from "react";
import { RecentsModelPicker } from "@/components/RecentsModelPicker";

function greetingForHour(hour: number, name: string) {
  if (hour <= 4) return `Burning the midnight oil, ${name}`;
  if (hour <= 11) return `Good morning, ${name}`;
  if (hour <= 16) return `Good afternoon, ${name}`;
  if (hour <= 20) return `Good evening, ${name}`;
  return `Up late, ${name}`;
}

function computeGreeting(date: Date, name = "David") {
  return greetingForHour(date.getHours(), name);
}

type Props = {
  displayName?: string;
  avatarColor?: string;
  avatarImage?: string | null;
  /** Already padded to RECENTS_CAP entries by the caller (App.tsx). */
  models: string[];
  activeModel: string;
  onSelectModel: (model: string) => void;
  onOpenSettings: () => void;
};

export function GreetingHero({ displayName = "David", avatarColor = "#ffbd38", avatarImage = null, models, activeModel, onSelectModel, onOpenSettings }: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => setNow(new Date());
    const interval = window.setInterval(refresh, 5 * 60 * 1000);
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="relative flex min-h-[420px] flex-1 items-center justify-center rounded-[28px] px-6 py-12 text-center">
      <div className="absolute inset-[30px_60px] overflow-hidden rounded-full bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--warm-glow)_10%,transparent),transparent_65%)]" />
      <div className="relative z-10 flex flex-col items-center">
        <div
          className="flex h-[92px] w-[92px] items-center justify-center overflow-hidden rounded-[24px] border border-[color-mix(in_srgb,var(--warm-glow)_32%,transparent)] font-expanded text-[42px] font-medium text-background-base"
          style={avatarImage ? undefined : { background: avatarColor }}
        >
          {avatarImage ? <img src={avatarImage} alt="" className="h-full w-full object-cover" /> : (displayName.trim()[0] || "D").toUpperCase()}
        </div>
        <div className="mt-[22px] text-[9px] uppercase tracking-[0.24em] text-foreground/70">Mission Control</div>
        <h1 className="mt-2.5 font-expanded text-[32px] font-medium tracking-[-0.01em] text-foreground">{computeGreeting(now, displayName)}</h1>
        <div className="mt-2">
          <RecentsModelPicker
            models={models}
            activeModel={activeModel}
            onSelectModel={onSelectModel}
            onOpenSettings={onOpenSettings}
          />
        </div>
        <div className="mt-3 text-[11px] text-foreground/70">Agent chat · live tools · memory · full observability</div>
      </div>
    </div>
  );
}
