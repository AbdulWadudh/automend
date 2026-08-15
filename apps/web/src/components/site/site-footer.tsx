import { config } from "@automend/shared";
import { Link } from "@tanstack/react-router";

const { routes, landingSections } = config.webClient;
const { productName, legalEntityName, repositoryUrl, emails } = config.company;

const linkClass =
  "rounded-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4";

/** `route` is the literal union from config, which is what the router's `to` prop accepts. */
type RoutePath = (typeof routes)[keyof typeof routes];

type FooterColumn = {
  heading: string;
  links: Array<{ label: string; anchor?: string; route?: RoutePath; href?: string }>;
};

const columns: FooterColumn[] = [
  {
    heading: "Product",
    links: [
      { label: "How it works", anchor: landingSections.howItWorks },
      { label: "Features", anchor: landingSections.features },
      { label: "Self-hosting", anchor: landingSections.selfHosting },
      { label: "FAQ", anchor: landingSections.faq },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Source code", href: repositoryUrl },
      { label: "Platform status", route: routes.status },
      { label: "Support", href: `mailto:${emails.support}` },
      { label: "Report a vulnerability", href: `mailto:${emails.security}` },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy policy", route: routes.privacy },
      { label: "Terms of service", route: routes.terms },
      { label: "Contact", href: `mailto:${emails.privacy}` },
    ],
  },
];

function FooterLink({ link }: { link: FooterColumn["links"][number] }) {
  if (link.anchor) {
    return (
      <Link to={routes.home} hash={link.anchor} className={linkClass}>
        {link.label}
      </Link>
    );
  }

  if (link.route) {
    return (
      <Link to={link.route} className={linkClass}>
        {link.label}
      </Link>
    );
  }

  const opensNewTab = link.href?.startsWith("http") ?? false;

  return (
    <a
      href={link.href}
      className={linkClass}
      target={opensNewTab ? "_blank" : undefined}
      rel={opensNewTab ? "noreferrer noopener" : undefined}
    >
      {link.label}
    </a>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 font-semibold tracking-tight">
            <img src="/logo.webp" alt="" width={32} height={20} className="h-5 w-auto" />
            {productName}
          </div>
          <p className="max-w-xs text-muted-foreground text-sm leading-relaxed">
            Self-hosted workflow automation with AI steps that run on your own infrastructure.
          </p>
        </div>

        {columns.map((column) => (
          <nav key={column.heading} aria-label={column.heading} className="space-y-3 text-sm">
            <h2 className="font-medium text-foreground">{column.heading}</h2>
            <ul className="space-y-2.5 text-muted-foreground">
              {column.links.map((link) => (
                <li key={link.label}>
                  <FooterLink link={link} />
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="mx-auto flex max-w-6xl flex-col gap-2 border-t px-6 py-6 text-muted-foreground text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()} {legalEntityName}. All rights reserved.
        </p>
        <p>
          Version <span className="tabular-nums">{config.appVersion}</span>
        </p>
      </div>
    </footer>
  );
}
