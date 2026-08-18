/**
 * One clock format across the run dashboard: `Aug 19, 2026 4:53 AM`.
 *
 * Pinned to `en-US` rather than the viewer's locale because the shape was chosen, and a browser set to
 * en-GB renders the same options as `19/08/2026, 04:53`. Times are still in the viewer's own zone.
 */

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const PRECISE_TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDateTime(value: string | Date): string {
  const date = toDate(value);

  // Composed rather than `dateStyle`/`timeStyle`, which insert a comma between the two halves.
  return `${DATE.format(date)} ${TIME.format(date)}`;
}

/** Seconds included, because timeline entries are often a few hundred milliseconds apart. */
export function formatTimeOfDay(value: string | Date): string {
  return PRECISE_TIME.format(toDate(value));
}

export function formatDate(value: string | Date): string {
  return DATE.format(toDate(value));
}
