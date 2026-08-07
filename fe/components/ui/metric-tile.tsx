import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type MetricIntent = "neutral" | "cashIn" | "cashOut" | "outstanding" | "credit";

const intentStyles: Record<MetricIntent, { icon: string; value: string }> = {
  neutral: {
    icon: "bg-[hsl(var(--metric-neutral-soft))] text-[hsl(var(--metric-neutral))]",
    value: "text-foreground",
  },
  cashIn: {
    icon: "bg-[hsl(var(--metric-cash-in-soft))] text-[hsl(var(--metric-cash-in))]",
    value: "text-[hsl(var(--metric-cash-in))]",
  },
  cashOut: {
    icon: "bg-[hsl(var(--metric-cash-out-soft))] text-[hsl(var(--metric-cash-out))]",
    value: "text-[hsl(var(--metric-cash-out))]",
  },
  outstanding: {
    icon: "bg-[hsl(var(--metric-outstanding-soft))] text-[hsl(var(--metric-outstanding))]",
    value: "text-[hsl(var(--metric-outstanding))]",
  },
  credit: {
    icon: "bg-[hsl(var(--metric-credit-soft))] text-[hsl(var(--metric-credit))]",
    value: "text-[hsl(var(--metric-credit))]",
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
  icon: LucideIcon;
  label: string;
  value: string;
  helper?: string;
  intent?: MetricIntent;
  className?: string;
}) {
  const styles = intentStyles[intent];
  return (
    <Card className={cn("border-border bg-card", className)}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", styles.icon)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={cn("truncate text-lg font-semibold tabular-nums", styles.value)}>{value}</p>
          {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
