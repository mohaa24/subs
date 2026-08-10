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

const intentStyles: Record<MetricTileIntent, string> = {
  user: "bg-slate-50 text-slate-500",
  neutral: "bg-slate-50 text-slate-500",
  cashIn: "bg-emerald-50 text-emerald-500",
  cashOut: "bg-sky-50 text-sky-500",
  outstanding: "bg-amber-50 text-amber-500",
  credit: "bg-cyan-50 text-cyan-500",
  transfer: "bg-teal-50 text-teal-500",
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
  const iconStyle = intentStyles[intent];
  return (
    <Card className={className} title={helper}>
      <CardContent className="flex items-center gap-3 p-4">
        {Icon ? (
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", iconStyle)}>
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold tabular-nums" title={value}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
