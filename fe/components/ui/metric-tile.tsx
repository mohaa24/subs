import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type MetricTileIntent =
  | "user"
  | "neutral"
  | "cashIn"
  | "cashOut"
  | "outstanding"
  | "credit"
  | "transfer";

const intentStyles: Record<MetricTileIntent, { tile: string; icon: string; value: string; dots: string }> = {
  user: {
    tile: "border-slate-200/80 bg-gradient-to-b from-white via-white to-slate-50",
    icon: "border-slate-200/70 bg-slate-50 text-slate-500",
    value: "text-[hsl(var(--tile-user-accent))]",
    dots: "border-slate-400",
  },
  neutral: {
    tile: "border-slate-200/80 bg-gradient-to-b from-white via-white to-slate-50",
    icon: "border-slate-200/70 bg-slate-50 text-slate-500",
    value: "text-[hsl(var(--tile-neutral-accent))]",
    dots: "border-slate-400",
  },
  cashIn: {
    tile: "border-emerald-200/70 bg-gradient-to-b from-white via-white to-emerald-50",
    icon: "border-emerald-200/70 bg-emerald-50 text-emerald-500",
    value: "text-[hsl(var(--tile-cash-in-accent))]",
    dots: "border-emerald-500",
  },
  cashOut: {
    tile: "border-sky-200/70 bg-gradient-to-b from-white via-white to-sky-50",
    icon: "border-sky-200/70 bg-sky-50 text-sky-500",
    value: "text-[hsl(var(--tile-cash-out-accent))]",
    dots: "border-sky-500",
  },
  outstanding: {
    tile: "border-amber-200/70 bg-gradient-to-b from-white via-white to-amber-50",
    icon: "border-amber-200/70 bg-amber-50 text-amber-500",
    value: "text-[hsl(var(--tile-outstanding-accent))]",
    dots: "border-amber-500",
  },
  credit: {
    tile: "border-cyan-200/70 bg-gradient-to-b from-white via-white to-cyan-50",
    icon: "border-cyan-200/70 bg-cyan-50 text-cyan-500",
    value: "text-[hsl(var(--tile-credit-accent))]",
    dots: "border-cyan-500",
  },
  transfer: {
    tile: "border-teal-200/70 bg-gradient-to-b from-white via-white to-teal-50",
    icon: "border-teal-200/70 bg-teal-50 text-teal-500",
    value: "text-[hsl(var(--tile-transfer-accent))]",
    dots: "border-teal-500",
  },
};

export function MetricTile({
  icon: Icon,
  label,
  value,
  helper,
  intent = "neutral",
  className,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  helper?: string;
  intent?: MetricTileIntent;
  className?: string;
}) {
  const styles = intentStyles[intent];
  return (
    <Card
      className={cn(
        "overflow-hidden rounded-2xl shadow-[0_4px_16px_rgba(15,23,42,0.05)]",
        styles.tile,
        className
      )}
    >
      <CardContent className="min-h-[156px] p-5 sm:p-6">
        <div className="flex items-center gap-4">
          {Icon ? (
            <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border shadow-sm", styles.icon)}>
              <Icon className="h-6 w-6" strokeWidth={2} />
            </div>
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-700">{label}</p>
            <span aria-hidden="true" className={cn("mt-2 block w-10 border-b-2 border-dotted", styles.dots)} />
          </div>
        </div>
        <p className={cn("mt-5 truncate text-2xl font-semibold tabular-nums", styles.value)} title={value}>{value}</p>
        {helper ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{helper}</p> : null}
      </CardContent>
    </Card>
  );
}
