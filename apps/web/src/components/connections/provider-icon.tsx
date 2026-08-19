import { SiDiscord, SiDiscordHex, SiGoogle, SiGoogleHex } from "@icons-pack/react-simple-icons";
import { KeyRoundIcon } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

/**
 * Official marks where they exist, and never a hand-drawn one.
 *
 * Slack is deliberately absent: Simple Icons no longer ships its logo, because Slack asked for it to be
 * removed. Redrawing it from memory would be exactly the brand misuse that removal is about, so a
 * connector without an official mark gets a lettermark instead — recognisably deliberate rather than
 * a wrong logo.
 *
 * The hex beside each component is the brand's own, exported by the same package.
 */
const BRAND_MARKS: Readonly<
  Record<string, { icon: ComponentType<{ className?: string; color?: string }>; hex: string }>
> = {
  google: { icon: SiGoogle, hex: SiGoogleHex },
  discord: { icon: SiDiscord, hex: SiDiscordHex },
};

/** A bearer token is not a brand, so it keeps the interface's own icon and the interface's own colour. */
const GENERIC_MARKS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  "api-token": KeyRoundIcon,
};

/**
 * The tile a brand mark sits on, and it is white in both themes on purpose.
 *
 * A brand hex is a single value chosen against white, so it cannot satisfy two surfaces: measured
 * against this app's `muted`, Google's blue is 2.80:1 in light mode and Slack's aubergine is 1.85:1 in
 * dark — an invisible logo either way. On white every mark clears 3:1 in both themes (Google 3.56:1,
 * Discord 4.61:1, and the near-black marks far higher), which is also the background their guidelines
 * assume. The ring keeps the tile itself visible against a light page.
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

  if (brand) {
    return <brand.icon className={cn("size-4 shrink-0", className)} color={brand.hex} />;
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
