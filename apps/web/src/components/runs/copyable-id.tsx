import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { IconAction } from "@/components/ui/tooltip";

/** A uuid's trailing group, which is enough to tell two runs apart at a glance. */
function lastSegment(value: string): string {
  return value.slice(value.lastIndexOf("-") + 1);
}

/**
 * The copy control sits inside the field holding the value, not beside it as a separate button.
 *
 * `short` shows only the trailing group — a full uuid in a dense row gets clipped, and a clipped id is
 * worse than a deliberately short one. Copying always yields the whole value either way.
 */
export function CopyableId({ label, value, short = false }: { label: string; value: string; short?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  }

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-muted/50 py-0.5 pr-0.5 pl-2 ring-1 ring-foreground/10">
      <span className="shrink-0 text-muted-foreground text-xs">{label}</span>
      <code className="truncate font-mono text-xs" title={short ? value : undefined}>
        {short ? lastSegment(value) : value}
      </code>
      <IconAction
        size="icon-xs"
        label={copied ? "Copied" : `Copy the ${label.toLowerCase()}`}
        tone={copied ? "view" : "neutral"}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </IconAction>
    </span>
  );
}
