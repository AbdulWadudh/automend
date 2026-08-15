import { config } from "@automend/shared";
import { Building2, KeyRound, type LucideIcon, Repeat2, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { Section } from "@/components/landing/section";

type Feature = {
  icon: LucideIcon;
  title: string;
  body: string;
};

const features: Feature[] = [
  {
    icon: Sparkles,
    title: "AI as a step, not a bolt-on",
    body: "Put a model anywhere in a flow — to classify, extract, summarise or decide which branch to take. You supply the key and choose the provider, so prompts and outputs stay inside your account.",
  },
  {
    icon: ShieldCheck,
    title: "Untrusted code stays boxed in",
    body: "Custom step code never runs inside the API or the worker's main process. It executes in an isolated subprocess with a timeout and a resource limit, so a runaway step takes down nothing but itself.",
  },
  {
    icon: Repeat2,
    title: "Retries that don't double-charge",
    body: "Every run and every step carries an idempotency key, checked and claimed inside a transaction. A retried step resumes work already in flight instead of sending the second email or taking the second payment.",
  },
  {
    icon: Workflow,
    title: "Nothing is lost between write and queue",
    body: "State changes and the jobs they schedule are committed together through a transactional outbox. A rolled-back write can never leave an orphan job behind, and a queued job always has the state it expects.",
  },
  {
    icon: Building2,
    title: "Multi-tenant from the first migration",
    body: "Every tenant-owned table carries a tenant id and every query is scoped by it — from the first table, not retrofitted later. One deployment can safely serve several teams.",
  },
  {
    icon: KeyRound,
    title: "Credentials encrypted at rest",
    body: "API keys and OAuth tokens are envelope-encrypted before they touch the database and are redacted from every log line, at every level. Plaintext secrets never appear in storage or in your log search.",
  },
];

export function Features() {
  return (
    <Section
      id={config.webClient.landingSections.features}
      eyebrow="Built for production"
      title="The unglamorous parts, taken seriously"
      description="Anything can run a workflow once. These are the properties that decide whether you still trust it after the hundredth run."
    >
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <li key={feature.title} className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <feature.icon className="size-4.5" />
            </span>
            <h3 className="mt-5 font-medium text-base tracking-tight">{feature.title}</h3>
            <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{feature.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
