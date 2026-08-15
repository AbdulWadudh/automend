import { config } from "@automend/shared";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const { routes, landingSections } = config.webClient;

export function CallToAction() {
  return (
    <section className="border-t">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <div className="rounded-2xl bg-card px-6 py-14 text-center ring-1 ring-foreground/10 sm:px-14">
          <h2 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">Clone it, run it, break it</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground leading-relaxed">
            It comes up in one command. If it does not, that is a bug worth hearing about — the repository is where this
            gets built, in the open.
          </p>

          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-11 px-5 text-base">
              <a href={config.company.repositoryUrl} target="_blank" rel="noreferrer noopener">
                View the source
                <ArrowRight className="size-4" />
              </a>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-11 px-5 text-base">
              <Link to={routes.home} hash={landingSections.selfHosting}>
                Read the quickstart
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
