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

const intentStyles: Record<MetricTileIntent, { tile: string; icon: string; value: string }> = {
  user: {
    tile: "border-slate-300 bg-[hsl(var(--tile-user-bg))]",
    icon: "bg-white/75 text-[hsl(var(--tile-user-accent))]",
    value: "text-[hsl(var(--tile-user-accent))]",
  },
  neutral: {
    tile: "border-slate-200 bg-[hsl(var(--tile-neutral-bg))]",
    icon: "bg-white/80 text-[hsl(var(--tile-neutral-accent))]",
    value: "text-[hsl(var(--tile-neutral-accent))]",
  },
  cashIn: {
    tile: "border-emerald-200 bg-[hsl(var(--tile-cash-in-bg))]",
    icon: "bg-white/80 text-[hsl(var(--tile-cash-in-accent))]",
    value: "text-[hsl(var(--tile-cash-in-accent))]",
  },
  cashOut: {
    tile: "border-sky-200 bg-[hsl(var(--tile-cash-out-bg))]",
    icon: "bg-white/80 text-[hsl(var(--tile-cash-out-accent))]",
    value: "text-[hsl(var(--tile-cash-out-accent))]",
  },
  outstanding: {
    tile: "border-amber-200 bg-[hsl(var(--tile-outstanding-bg))]",
    icon: "bg-white/80 text-[hsl(var(--tile-outstanding-accent))]",
    value: "text-[hsl(var(--tile-outstanding-accent))]",
  },
  credit: {
    tile: "border-cyan-200 bg-[hsl(var(--tile-credit-bg))]",
    icon: "bg-white/80 text-[hsl(var(--tile-credit-accent))]",
    value: "text-[hsl(var(--tile-credit-accent))]",
  },
  transfer: {
    tile: "border-teal-200 bg-[hsl(var(--tile-transfer-bg))]",
    icon: "bg-white/80 text-[hsl(var(--tile-transfer-accent))]",
    value: "text-[hsl(var(--tile-transfer-accent))]",
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
    <Card className={cn("overflow-hidden shadow-sm", styles.tile, className)}>
      <CardContent className="flex min-h-[92px] items-center gap-3 p-4">
        {Icon ? (
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-sm", styles.icon)}>
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-600">{label}</p>
          <p className={cn("truncate text-lg font-semibold tabular-nums", styles.value)}>{value}</p>
          {helper ? <p className="mt-1 line-clamp-2 text-xs text-slate-600">{helper}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
