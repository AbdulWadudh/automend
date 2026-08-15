import { config } from "@automend/shared";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

const { routes, landingSections } = config.webClient;

const sectionLinks = [
  { anchor: landingSections.howItWorks, label: "How it works" },
  { anchor: landingSections.features, label: "Features" },
  { anchor: landingSections.selfHosting, label: "Self-hosting" },
  { anchor: landingSections.faq, label: "FAQ" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link
          to={routes.home}
          className="flex items-center gap-2.5 rounded-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
        >
          {/*
            Intrinsic size is 380x238; width and height are set from that ratio so the header does
            not reflow while the logo loads. `alt` is empty because the adjacent wordmark already
            names the app — announcing it twice is noise for a screen reader.
          */}
          <img src="/logo.webp" alt="" width={32} height={20} className="h-5 w-auto" />
          {config.company.productName}
        </Link>

        <ul className="hidden items-center gap-7 text-muted-foreground text-sm lg:flex">
          {sectionLinks.map((section) => (
            <li key={section.anchor}>
              <Link
                to={routes.home}
                hash={section.anchor}
                className="rounded-sm py-2 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-1.5">
          <Button asChild variant="ghost" size="lg" className="hidden sm:inline-flex">
            <Link to={routes.status}>Status</Link>
          </Button>
          <Button asChild size="lg">
            <Link to={routes.home} hash={landingSections.selfHosting}>
              Get started
            </Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
