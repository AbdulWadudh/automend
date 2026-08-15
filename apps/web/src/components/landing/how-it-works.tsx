import { config } from "@automend/shared";
import { MousePointerClick, PlayCircle, Radio } from "lucide-react";
import { Section } from "@/components/landing/section";

const steps = [
  {
    icon: Radio,
    title: "Start with a trigger",
    body: "A webhook, a schedule, or an event from a connected app. The flow wakes up with a validated payload — anything malformed is rejected at the edge, before it reaches your steps.",
  },
  {
    icon: MousePointerClick,
    title: "Compose the steps",
    body: "Drag steps onto the canvas and wire them together: call an API, transform data, branch on a condition, loop over a list, or hand the decision to a model. Every step sees the output of the ones before it.",
  },
  {
    icon: PlayCircle,
    title: "Let it run",
    body: "Runs are queued, executed and recorded. Failed steps retry with backoff, side effects are keyed so a retry never fires twice, and every attempt is inspectable afterwards.",
  },
];

export function HowItWorks() {
  return (
    <Section
      id={config.webClient.landingSections.howItWorks}
      eyebrow="How it works"
      title="Three steps from idea to something that runs at 3am"
      description="The canvas is the easy part. What makes an automation trustworthy is everything that happens after you hit save."
    >
      <ol className="grid gap-6 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="relative rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <step.icon className="size-4.5" />
              </span>
              <span className="font-medium text-muted-foreground text-xs tabular-nums">
                Step {index + 1} of {steps.length}
              </span>
            </div>

            <h3 className="mt-5 font-medium text-lg tracking-tight">{step.title}</h3>
            <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
