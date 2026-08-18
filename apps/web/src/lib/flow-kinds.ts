/**
 * How a node is presented on the canvas: its colour and its icon.
 *
 * Keyed by kit id, not by what a step does. Before kits there were four step kinds and four entries; now the
 * set is the registry, so this is a lookup with a fallback rather than an exhaustive map — a kit added tomorrow
 * renders correctly without this file being touched, which is the whole point of the model.
 *
 * The labels and descriptions that used to live here come from the catalogue instead: they are the kit author's
 * words, and duplicating them in the browser is how the picker comes to disagree with the engine.
 */

import { CircleDotIcon, ClockIcon, GlobeIcon, MailIcon, ScrollTextIcon, TimerIcon, ZapIcon } from "lucide-react";
import type { ComponentType } from "react";

export type IconComponent = ComponentType<{ className?: string }>;

/**
 * The colour a node wears.
 *
 * Every class is written out in full rather than composed from the accent name, because Tailwind finds classes
 * by scanning source text — a template literal like `bg-node-${accent}` produces no CSS at all. The `stroke`
 * value is a raw custom property because it is handed to React Flow as an inline SVG style rather than applied
 * as a class.
 */
export type NodeAccent = {
  /** The icon tile: a tinted background with the accent as its foreground. */
  chip: string;
  /** The ring drawn around the node while it is selected. */
  ring: string;
  /** The connection handles, which are React Flow's own elements and need the `!` override. */
  handle: string;
  /** Edge colour, so a connection is visibly the continuation of the node it leaves. */
  stroke: string;
};

const ACCENTS = {
  emerald: {
    chip: "bg-node-emerald/15 text-node-emerald",
    ring: "ring-node-emerald/70",
    handle: "group-hover:!bg-node-emerald hover:!bg-node-emerald",
    stroke: "var(--node-emerald)",
  },
  sky: {
    chip: "bg-node-sky/15 text-node-sky",
    ring: "ring-node-sky/70",
    handle: "group-hover:!bg-node-sky hover:!bg-node-sky",
    stroke: "var(--node-sky)",
  },
  violet: {
    chip: "bg-node-violet/15 text-node-violet",
    ring: "ring-node-violet/70",
    handle: "group-hover:!bg-node-violet hover:!bg-node-violet",
    stroke: "var(--node-violet)",
  },
  amber: {
    chip: "bg-node-amber/15 text-node-amber",
    ring: "ring-node-amber/70",
    handle: "group-hover:!bg-node-amber hover:!bg-node-amber",
    stroke: "var(--node-amber)",
  },
  rose: {
    chip: "bg-node-rose/15 text-node-rose",
    ring: "ring-node-rose/70",
    handle: "group-hover:!bg-node-rose hover:!bg-node-rose",
    stroke: "var(--node-rose)",
  },
  cyan: {
    chip: "bg-node-cyan/15 text-node-cyan",
    ring: "ring-node-cyan/70",
    handle: "group-hover:!bg-node-cyan hover:!bg-node-cyan",
    stroke: "var(--node-cyan)",
  },
} as const satisfies Record<string, NodeAccent>;

/**
 * One accent per kit, so a colour means the same service everywhere it appears.
 *
 * Distinct hues, because a colour that repeats across two kits an author sees side by side conveys nothing.
 */
const KIT_ACCENTS: Readonly<Record<string, NodeAccent>> = {
  core: ACCENTS.violet,
  http: ACCENTS.sky,
  gmail: ACCENTS.rose,
};

/**
 * A kit nobody has styled yet still has to look deliberate.
 *
 * Reaching for a fallback is the normal case for a newly added kit, not an error state — so it is a real accent
 * from the palette rather than an unstyled grey.
 */
const FALLBACK_ACCENT = ACCENTS.cyan;

/**
 * Icons by kit, then by the specific action or trigger where one kit does several different things.
 *
 * `core` needs the finer grain: a wait, a log line and three ways of starting a flow are not the same gesture,
 * and one icon for all five would make the canvas unreadable.
 */
const KIT_ICONS: Readonly<Record<string, IconComponent>> = {
  core: CircleDotIcon,
  http: GlobeIcon,
  gmail: MailIcon,
};

const MEMBER_ICONS: Readonly<Record<string, IconComponent>> = {
  "core.delay": TimerIcon,
  "core.log": ScrollTextIcon,
  "core.manual": CircleDotIcon,
  "core.webhook": ZapIcon,
  "core.schedule": ClockIcon,
};

const FALLBACK_ICON = CircleDotIcon;

export function accentForKit(kitId: string): NodeAccent {
  return KIT_ACCENTS[kitId] ?? FALLBACK_ACCENT;
}

/** `name` is the action or trigger name, which only some kits need to distinguish on. */
export function iconForMember(kitId: string, name: string): IconComponent {
  return MEMBER_ICONS[`${kitId}.${name}`] ?? KIT_ICONS[kitId] ?? FALLBACK_ICON;
}

/**
 * The line under a node's name: which service, and what this node does with it.
 *
 * Built from the catalogue's own words when they are available and from the stored identifiers when they are
 * not — a node whose kit has been removed still has to render, and `gmail.sendEmail` is a more useful thing to
 * show an author than a blank line.
 */
export function describeNode(options: {
  kitId: string;
  name: string;
  kitName: string | undefined;
  displayName: string | undefined;
}): string {
  const { kitId, name, kitName, displayName } = options;

  if (kitName && displayName) {
    return `${kitName} · ${displayName}`;
  }

  return `${kitId}.${name}`;
}
