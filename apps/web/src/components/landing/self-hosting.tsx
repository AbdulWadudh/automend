import { config } from "@automend/shared";
import { Activity, Boxes, Database, HeartPulse } from "lucide-react";
import { Section } from "@/components/landing/section";

const quickstart = [
  `git clone ${config.company.repositoryUrl}.git`,
  "cp .env.example .env",
  "docker compose up -d --build",
];

const included = [
  {
    icon: Boxes,
    title: "One image per service",
    body: "API, worker and web build independently and read every setting from the environment.",
  },
  {
    icon: Database,
    title: "Postgres and Redis",
    body: "Migrations run before the apps start. Nothing assumes local disk, so containers stay disposable.",
  },
  {
    icon: HeartPulse,
    title: "Real health checks",
    body: "Each long-running service probes its actual dependencies, so your orchestrator restarts on genuine failure.",
  },
  {
    icon: Activity,
    title: "Telemetry you own",
    body: "Structured JSON to stdout and OTLP to any collector you point it at. No vendor SDK in the way.",
  },
];

function Quickstart() {
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex items-center gap-1.5 border-b px-4 py-3">
        <span className="size-2.5 rounded-full bg-muted-foreground/30" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-muted-foreground/30" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-muted-foreground/30" aria-hidden="true" />
        <span className="ml-2 text-muted-foreground text-xs">Terminal</span>
      </div>

      <pre className="overflow-x-auto p-5 text-sm leading-relaxed">
        <code>
          {quickstart.map((command) => (
            <span key={command} className="block">
              <span className="select-none text-brand">$ </span>
              {command}
            </span>
          ))}
        </code>
      </pre>

      <p className="border-t px-5 py-3.5 text-muted-foreground text-xs">
        The stack comes up on <span className="text-foreground">localhost:{config.services.web.defaultPort}</span>.
        Everything else is one <span className="text-foreground">.env</span> file.
      </p>
    </div>
  );
}

export function SelfHosting() {
  return (
    <Section
      id={config.webClient.landingSections.selfHosting}
      eyebrow="Self-hosting"
      title="Your servers, your database, your model keys"
      description="Nothing phones home. Run it on a laptop, a single VPS, or a Kubernetes cluster — the same containers, configured entirely through environment variables."
    >
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-14">
        <Quickstart />

        <ul className="grid gap-6 sm:grid-cols-2">
          {included.map((item) => (
            <li key={item.title}>
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <item.icon className="size-4.5" />
              </span>
              <h3 className="mt-4 font-medium text-base tracking-tight">{item.title}</h3>
              <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
