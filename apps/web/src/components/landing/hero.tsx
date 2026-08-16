import { config } from "@automend/shared";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Lock, Server, Workflow } from "lucide-react";
import { FlowPreview } from "@/components/landing/flow-preview";
import { Button } from "@/components/ui/button";

const { routes, landingSections } = config.webClient;

const assurances = [
  { icon: Server, label: "Runs on your infrastructure" },
  { icon: Lock, label: "Your model keys, your data" },
  { icon: Workflow, label: "Visual flows, real execution engine" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid" aria-hidden="true" />

      <div className="relative mx-auto grid max-w-6xl gap-14 px-6 py-20 sm:py-28 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-muted-foreground text-xs">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
            Early access — building in the open
          </p>

          <h1 className="mt-6 text-balance font-semibold text-4xl tracking-tight sm:text-5xl lg:text-6xl">
            AI automation that runs <span className="text-brand">where your data already lives</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg text-muted-foreground leading-relaxed">
            {config.company.productName} is a self-hosted automation platform. Draw a flow, drop an AI step anywhere in
            it, and let a real execution engine handle the retries, branches and failures — on servers you control.
          </p>

          {/*
            Two paths, because there are genuinely two: use the instance in front of you, or run
            your own. "See how it works" is not repeated here — it is in the nav, and it is the
            next section down the page anyway.
          */}
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-11 px-5 text-base">
              <Link to={routes.signUp}>
                Start building
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-11 px-5 text-base">
              <Link to={routes.home} hash={landingSections.selfHosting}>
                Deploy it yourself
              </Link>
            </Button>
          </div>

          <ul className="mt-10 flex flex-col gap-3 text-muted-foreground text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
            {assurances.map((assurance) => (
              <li key={assurance.label} className="flex items-center gap-2">
                <assurance.icon className="size-4 text-brand" />
                {assurance.label}
              </li>
            ))}
          </ul>
        </div>

        <FlowPreview />
      </div>
    </section>
  );
}
