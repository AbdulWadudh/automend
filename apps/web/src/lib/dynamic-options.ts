/**
 * The decisions a dynamic dropdown makes before it renders anything.
 *
 * Separated from the component because each one is a rule rather than a layout: when it is allowed to
 * ask the service, what it sends, and whether a saved value still means anything. Those are the parts
 * worth a test, and the parts that break quietly — an over-broad request key refetches on every
 * keystroke somewhere else in the panel, and nobody notices until the service starts rate-limiting.
 */

import type { PropertyOption } from "@automend/shared";

export function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * The properties a loader needs that the author has not filled in yet.
 *
 * Non-empty means there is nothing worth asking for: a loader sent "the tabs in spreadsheet undefined"
 * answers with an error, and an error is a worse thing to show than a sentence saying what to do next.
 */
export function findUnmetDependencies(
  input: Record<string, unknown>,
  dependsOn: readonly string[] | undefined,
): string[] {
  return (dependsOn ?? []).filter((name) => isMissing(input[name]));
}

/**
 * Only the inputs the loader reads.
 *
 * The request is the query key, so sending the whole step would refetch the channel list every time
 * somebody typed a character into the message field.
 */
export function narrowToDependencies(
  input: Record<string, unknown>,
  dependsOn: readonly string[] | undefined,
): Record<string, unknown> {
  const narrowed: Record<string, unknown> = {};

  for (const name of dependsOn ?? []) {
    narrowed[name] = input[name];
  }

  return narrowed;
}

/**
 * A saved value the service no longer offers — an archived channel, or one the app was removed from.
 *
 * Worth saying rather than silently showing an empty control: the flow still holds the old value and
 * would fail at the step, so the author needs to know before the run does.
 */
export function isStaleSelection(value: string, options: readonly PropertyOption[]): boolean {
  return value !== "" && !options.some((option) => option.value === value);
}
