import type * as React from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Its own file rather than part of `tooltip.tsx`, which the shadcn CLI owns and rewrites: this lived
 * there until `shadcn apply` replaced that file and took it with it.
 *
 * The tones are drawn from the same accents the flow nodes use, so a colour means the same thing
 * wherever it appears — and colour is reinforcement only, since every one of these carries a tooltip
 * and an `aria-label`. A row of glyphs distinguished by hue alone is unreadable to a good number of
 * people. Written out in full because Tailwind finds classes by scanning source text.
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
export function IconAction({
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
