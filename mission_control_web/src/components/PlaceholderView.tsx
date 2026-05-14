import { Activity } from "lucide-react";

export function PlaceholderView({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <section className="flex flex-1 flex-col">
      <div>
        <h1 className="font-expanded text-xl font-medium text-foreground">{title}</h1>
        <p className="mt-1 text-[11px] text-foreground/70">{subtitle}</p>
      </div>
      <div className="flex flex-1 items-center justify-center py-12">
        <div className="flex min-h-[220px] w-full max-w-xl flex-col items-center justify-center rounded-[10px] border border-dashed border-foreground/18 px-6 py-10 text-center">
          <Activity className="h-7 w-7 text-[color-mix(in_srgb,var(--warm-glow)_70%,transparent)]" />
          <div className="mt-4 text-sm text-foreground/70">Building in the next slice</div>
        </div>
      </div>
    </section>
  );
}
