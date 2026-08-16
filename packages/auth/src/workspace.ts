/**
 * Naming for the workspace every account gets on sign-up.
 *
 * A workspace is the tenant, so one has to exist before the first flow can be stored. Its name and
 * slug are derived from whatever the sign-up carried — which, for an OAuth profile, may be nothing
 * more than an email address.
 */

import { config } from "@automend/shared";

const { organization: organizationConfig } = config.auth;
const { workspaceName } = config.validation;

/** Everything a URL-safe slug may contain; any run of other characters becomes one separator. */
const SLUG_DISALLOWED_PATTERN = /[^a-z0-9]+/g;
const SLUG_TRIM_PATTERN = /^-+|-+$/g;

/** Excludes vowels and lookalikes, so a generated slug cannot spell something unfortunate. */
const SLUG_SUFFIX_ALPHABET = "bcdfghjkmnpqrstvwxz23456789";

export function buildPersonalWorkspaceName(userName: string | null | undefined): string {
  const trimmed = userName?.trim();

  if (!trimmed) {
    return organizationConfig.fallbackWorkspaceName;
  }

  const candidate = `${trimmed}${organizationConfig.personalWorkspaceSuffix}`;

  return candidate.slice(0, workspaceName.maxLength);
}

function randomSlugSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(organizationConfig.slugRandomSuffixLength));

  return Array.from(bytes, (byte) => SLUG_SUFFIX_ALPHABET[byte % SLUG_SUFFIX_ALPHABET.length]).join("");
}

/**
 * Always suffixed with random characters rather than checked for availability first: slugs are
 * global, and a check-then-insert would race two simultaneous sign-ups of the same name.
 */
export function buildWorkspaceSlug(source: string): string {
  const base = source
    .toLowerCase()
    .replace(SLUG_DISALLOWED_PATTERN, organizationConfig.slugSeparator)
    .replace(SLUG_TRIM_PATTERN, "");

  const suffix = randomSlugSuffix();
  const availableLength = workspaceName.maxLength - suffix.length - organizationConfig.slugSeparator.length;
  const trimmedBase = base.slice(0, Math.max(availableLength, 0)).replace(SLUG_TRIM_PATTERN, "");

  if (!trimmedBase) {
    return suffix;
  }

  return `${trimmedBase}${organizationConfig.slugSeparator}${suffix}`;
}
