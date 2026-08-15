import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionProps = {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /**
   * Heading beside the content instead of above it.
   *
   * For a section whose content is a single readable column — prose capped for line length rather
   * than a grid that fills the container — stacking leaves the width beside it empty. The split
   * puts that width to work and lets the heading track the content as it scrolls.
   */
  layout?: "stacked" | "split";
};

/**
 * `scroll-mt` repeats what `scroll-padding-top` already does on the root, because the root value
 * only applies to anchors the browser resolves itself — not to the router's programmatic scroll.
 */
export function Section({ id, eyebrow, title, description, children, className, layout = "stacked" }: SectionProps) {
  const headingId = `${id}-heading`;
  const isSplit = layout === "split";

  return (
    <section id={id} aria-labelledby={headingId} className={cn("scroll-mt-24 border-t py-20 sm:py-28", className)}>
      <div
        className={cn(
          "mx-auto max-w-6xl px-6",
          isSplit && "lg:grid lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-16",
        )}
      >
        <div className={cn("max-w-2xl", isSplit && "lg:sticky lg:top-24")}>
          <p className="font-medium text-brand text-sm tracking-wide">{eyebrow}</p>
          <h2 id={headingId} className="mt-3 text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
            {title}
          </h2>
          {description && <p className="mt-4 text-lg text-muted-foreground leading-relaxed">{description}</p>}
        </div>

        <div className={cn("mt-12", isSplit && "lg:mt-0")}>{children}</div>
      </div>
    </section>
  );
}
