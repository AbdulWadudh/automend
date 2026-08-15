import { config } from "@automend/shared";

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  closing?: string[];
};

type LegalPageProps = {
  title: string;
  summary: string;
  sections: LegalSection[];
};

function sectionId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Formatted in UTC on purpose: the date is a plain calendar date, and parsing it as an instant
 * would render the day before for any viewer west of Greenwich.
 */
function formatEffectiveDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(isoDate));
}

export function LegalPage({ title, summary, sections }: LegalPageProps) {
  const effectiveDate = config.company.legal.effectiveDate;

  return (
    <article className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <header className="border-b pb-10">
        <h1 className="font-semibold text-4xl tracking-tight">{title}</h1>
        <p className="mt-3 text-muted-foreground text-sm">
          Effective <time dateTime={effectiveDate}>{formatEffectiveDate(effectiveDate)}</time>
        </p>
        <p className="mt-6 text-lg text-muted-foreground leading-relaxed">{summary}</p>
      </header>

      <nav aria-label="On this page" className="border-b py-8">
        <h2 className="font-medium text-sm">On this page</h2>
        <ol className="mt-4 grid gap-x-8 gap-y-2 text-muted-foreground text-sm sm:grid-cols-2">
          {sections.map((section, index) => (
            <li key={section.heading}>
              <a
                href={`#${sectionId(section.heading)}`}
                className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
              >
                <span className="tabular-nums">{index + 1}.</span> {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="divide-y">
        {sections.map((section, index) => (
          <section key={section.heading} id={sectionId(section.heading)} className="scroll-mt-24 py-10">
            <h2 className="font-medium text-xl tracking-tight">
              <span className="mr-2 text-muted-foreground tabular-nums">{index + 1}.</span>
              {section.heading}
            </h2>

            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-4 text-muted-foreground leading-relaxed">
                {paragraph}
              </p>
            ))}

            {section.bullets && (
              <ul className="mt-4 space-y-2.5 text-muted-foreground leading-relaxed">
                {section.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-3">
                    <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            )}

            {section.closing?.map((paragraph) => (
              <p key={paragraph} className="mt-4 text-muted-foreground leading-relaxed">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
