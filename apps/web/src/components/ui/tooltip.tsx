import { Tooltip as TooltipPrimitive } from "radix-ui";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The label for a control that shows only an icon.
 *
 * Radix opens it on focus as well as on hover, which is the part that matters: a tooltip that
 * appears only under a pointer takes the label away from anyone using a keyboard. It is a label of
 * last resort, not a place for extra information — the button still carries an `aria-label`, since
 * a screen reader announces that rather than waiting for a hover that never happens.
 *
 * Each tooltip brings its own provider so a caller cannot forget to add one at the root.
 */
function Tooltip({
  children,
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root> & { delayDuration?: number }) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root data-slot="tooltip" {...props}>
        {children}
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md bg-foreground px-2 py-1 text-background text-xs",
          "data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=delayed-open]:animate-in",
          "data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/**
 * What kind of thing an icon action does, drawn from the same accents the flow nodes use.
 *
 * One palette across the product, so a colour means the same thing wherever it appears. The colour
 * is reinforcement only: every one of these carries a tooltip and an `aria-label`, because a row of
 * glyphs distinguished by hue alone is unreadable to a good number of people.
 *
 * Written out in full because Tailwind finds classes by scanning source text — a name assembled at
 * runtime produces no CSS.
 */
const ICON_ACTION_TONES = {
  neutral: "text-muted-foreground hover:bg-muted hover:text-foreground",
  view: "text-node-cyan hover:bg-node-cyan/10 hover:text-node-cyan",
  credential: "text-node-amber hover:bg-node-amber/10 hover:text-node-amber",
  refresh: "text-node-sky hover:bg-node-sky/10 hover:text-node-sky",
  edit: "text-node-violet hover:bg-node-violet/10 hover:text-node-violet",
  danger: "text-destructive hover:bg-destructive/10 hover:text-destructive",
} as const;

export type IconActionTone = keyof typeof ICON_ACTION_TONES;

/**
 * A control that shows an icon and names itself on hover, on focus and to a screen reader.
 *
 * A real `Button` rather than a bare trigger: Radix's trigger renders an unstyled `button`, which
 * leaves the icon with no hover state, no focus ring and a hit area the size of the glyph.
 */
function IconAction({
  label,
  tone = "neutral",
  children,
  variant = "ghost",
  size = "icon-sm",
  className,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; tone?: IconActionTone }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          aria-label={label}
          className={cn(ICON_ACTION_TONES[tone], className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export { IconAction, Tooltip, TooltipContent, TooltipTrigger };
