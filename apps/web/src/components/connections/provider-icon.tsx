import { SiDiscord, SiDiscordHex } from "@icons-pack/react-simple-icons";
import { KeyRoundIcon } from "lucide-react";
import type { ComponentType } from "react";
import { FcGoogle } from "react-icons/fc";
import { cn } from "@/lib/utils";

/**
 * How a connector gets its mark, so a new one never needs this decided again.
 *
 * 1. If the logo is genuinely multi-colour and a faithful glyph exists, use it — `react-icons/fc`.
 *    Google's G is four colours, and drawing it in one is a different logo, not a dimmer one.
 * 2. Otherwise use the single-path mark tinted with the brand's **own** hex —
 *    `@icons-pack/react-simple-icons`, which exports the hex beside every icon so no brand colour is
 *    ever hand-typed here.
 * 3. If no package ships the mark, use a lettermark in the brand's colour. Never redraw a logo.
 *
 * Everything sits on the same white tile (see `BRAND_TILE`), so the family reads as one row of marks
 * rather than as whatever each icon set happened to look like.
 */
type BrandMark =
  | { kind: "icon"; icon: ComponentType<{ className?: string; color?: string }>; hex?: string }
  /**
   * Slack asked Simple Icons to remove its logo, and react-icons' snapshot has none either — the only
   * `SiSlack*` export anywhere is Slackware, a Linux distribution. Font Awesome still ships one, but
   * pulling a third icon package to render a mark whose owner asked for its withdrawal is the wrong
   * trade. A letter in Slack's own aubergine is recognisably deliberate; a wrong logo is not.
   */
  | { kind: "letter"; hex: string };

const BRAND_MARKS: Readonly<Record<string, BrandMark>> = {
  google: { kind: "icon", icon: FcGoogle },
  discord: { kind: "icon", icon: SiDiscord, hex: SiDiscordHex },
  slack: { kind: "letter", hex: "#4A154B" },
};

/** A bearer token is not a company, so it keeps the interface's own icon and the interface's own colour. */
const GENERIC_MARKS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  "api-token": KeyRoundIcon,
};

/**
 * The tile a brand mark sits on, and it is white in both themes on purpose.
 *
 * A brand's colours are chosen against white, so they cannot satisfy two surfaces: measured against
 * this app's `muted`, Google's blue is 2.80:1 in light mode and Slack's aubergine is 1.85:1 in dark —
 * an invisible logo either way. On white every mark clears 3:1 in both themes (Google 3.56:1, Discord
 * 4.61:1, Slack's aubergine far higher), which is also the background their guidelines assume. The
 * ring keeps the tile itself visible against a light page.
 */
const BRAND_TILE = "bg-white ring-1 ring-foreground/10";

export function ProviderIcon({
  providerId,
  label,
  className,
}: {
  providerId: string;
  label: string;
  className?: string;
}) {
  const brand = BRAND_MARKS[providerId];

  if (brand?.kind === "icon") {
    return <brand.icon className={cn("size-4 shrink-0", className)} color={brand.hex} />;
  }

  if (brand?.kind === "letter") {
    return (
      <span
        aria-hidden="true"
        className={cn("inline-flex size-4 shrink-0 items-center justify-center font-bold text-[0.75rem]", className)}
        style={{ color: brand.hex }}
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  const Generic = GENERIC_MARKS[providerId];

  if (Generic) {
    return <Generic className={cn("size-4 shrink-0", className)} />;
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded bg-muted font-semibold text-[0.625rem] text-muted-foreground",
        className,
      )}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Whether this provider's mark needs the white tile, so a caller can style the container it draws. */
export function tileClassForProvider(providerId: string): string {
  return providerId in BRAND_MARKS ? BRAND_TILE : "bg-muted";
}
