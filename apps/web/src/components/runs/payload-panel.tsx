import { config } from "@automend/shared";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { IconAction } from "@/components/ui/icon-action";

const { payloadPreviewChars } = config.runs.dashboard;

function stringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "(nothing)";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * A step can return far more JSON than a page can render. What is shown is capped, but what is copied
 * is the whole thing — truncating the clipboard would be the one place the cut actually costs someone.
 */
export function PayloadPanel({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const full = stringify(value);
  const isTruncated = full.length > payloadPreviewChars;
  const shown = isTruncated ? full.slice(0, payloadPreviewChars) : full;

  async function copy() {
    await navigator.clipboard.writeText(full);
    setCopied(true);
  }

  return (
    <details className="group/panel rounded-lg bg-muted/40 ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{full.length.toLocaleString()} characters</span>
      </summary>

      <div className="relative border-t">
        <IconAction
          label={copied ? "Copied" : `Copy the ${label.toLowerCase()}`}
          tone={copied ? "view" : "neutral"}
          className="absolute top-1.5 right-1.5"
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </IconAction>

        <pre className="max-h-80 overflow-auto px-3 py-2 pr-10 font-mono text-xs leading-relaxed">{shown}</pre>

        {isTruncated && (
          <p className="border-t px-3 py-1.5 text-muted-foreground text-xs">
            Shown up to {payloadPreviewChars.toLocaleString()} characters. Copy to get all of it.
          </p>
        )}
      </div>
    </details>
  );
}
