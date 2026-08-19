import { SiDiscord, SiGoogle } from "@icons-pack/react-simple-icons";
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
 */
const BRAND_MARKS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  google: SiGoogle,
  discord: SiDiscord,
};

/** A bearer token is not a brand, so it keeps the interface's own icon. */
const GENERIC_MARKS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  "api-token": KeyRoundIcon,
};

export function ProviderIcon({
  providerId,
  label,
  className,
}: {
  providerId: string;
  label: string;
  className?: string;
}) {
  const Brand = BRAND_MARKS[providerId];

  if (Brand) {
    return <Brand className={cn("size-4 shrink-0", className)} />;
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
