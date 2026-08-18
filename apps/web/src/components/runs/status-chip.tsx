import { Badge } from "@/components/ui/badge";
import type { StatusTone } from "@/lib/run-status";
import { cn } from "@/lib/utils";

/** Icon and label always travel together: a row of chips separated only by hue is unreadable. */
export function StatusChip({ tone, className }: { tone: StatusTone; className?: string }) {
  const Icon = tone.icon;

  return (
    <Badge variant="secondary" className={cn(tone.chip, className)}>
      <Icon className={cn("size-3", tone.isBusy && "animate-spin")} />
      {tone.label}
    </Badge>
  );
}
