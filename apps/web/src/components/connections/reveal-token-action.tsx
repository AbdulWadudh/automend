import type { Connection } from "@automend/shared";
import { useMutation } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconAction } from "@/components/ui/icon-action";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { revealConnectionToken } from "@/lib/connections-api";

/**
 * Shows a stored token, in a popover anchored to its own button.
 *
 * In a popover rather than inline because a revealed secret is a glance, not a change to the page:
 * expanding the card pushed every control beside it out of place, which is a poor trade for text you
 * are about to copy and dismiss.
 *
 * Closing forgets the value rather than hiding it, so the token lives in the page only while it is on
 * screen and reopening is another audited request.
 */
export function RevealTokenAction({ connection }: { connection: Connection }) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const reveal = useMutation({ mutationFn: () => revealConnectionToken(connection.id) });
  const { mutate: requestToken, reset: forgetToken } = reveal;

  function handleOpenChange(open: boolean) {
    setIsOpen(open);
    setCopied(false);

    if (open) {
      requestToken();
      return;
    }

    forgetToken();
  }

  async function copyToken() {
    if (!reveal.data) {
      return;
    }

    await navigator.clipboard.writeText(reveal.data);
    setCopied(true);
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-node-cyan hover:bg-node-cyan/10 hover:text-node-cyan"
              aria-label={`View the token for ${connection.displayName}`}
            >
              {isOpen ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{isOpen ? "Hide the token" : "View the token"}</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="w-80 space-y-2 p-3">
        {reveal.isPending && <p className="text-muted-foreground text-xs">Fetching…</p>}

        {reveal.isError && (
          <p role="alert" className="text-destructive text-xs">
            {reveal.error.message}
          </p>
        )}

        {reveal.data && (
          // Copy belongs on the value, not beside it: the button is the field's own affordance, pinned
          // so it stays reachable while a long token scrolls underneath it.
          <div className="relative">
            <p className="max-h-32 overflow-y-auto break-all rounded-lg bg-muted py-2 pr-9 pl-2.5 font-mono text-xs">
              {reveal.data}
            </p>
            <IconAction
              label={copied ? "Copied" : "Copy the token"}
              tone={copied ? "view" : "neutral"}
              className="absolute top-1 right-1"
              onClick={() => void copyToken()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </IconAction>
            <span className="sr-only" aria-live="polite">
              {copied ? "Token copied to the clipboard" : ""}
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
