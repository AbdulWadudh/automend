import { config } from "@automend/shared";
import { ChevronDown } from "lucide-react";
import { Section } from "@/components/landing/section";

const { productName } = config.company;

const questions = [
  {
    question: `Can I use ${productName} today?`,
    answer: `Not for production work yet. The monorepo, services, database, queue, telemetry and container builds are wired together and verified end to end — flow execution, authentication and the visual canvas are what is being built now. Early access means you can run it, read every line of it and shape where it goes.`,
  },
  {
    question: "Which AI models can I use?",
    answer:
      "Whichever you can reach over HTTP. You bring your own key and pick the provider per step, so a flow can use a frontier model for a hard classification and a small local one for the routine pass. Nothing is routed through us — there is no us to route it through.",
  },
  {
    question: "Does any of my data leave my network?",
    answer: `${productName} makes no outbound calls of its own. The only requests that leave your infrastructure are the ones your flows explicitly make, to the APIs and models you configured. There is no telemetry back to the project and no account to sign into.`,
  },
  {
    question: "What do I need to run it?",
    answer:
      "Docker with Compose v2, and somewhere to put a Postgres database and a Redis-compatible server — both come up with the stack if you do not have them. A single small VPS is enough to start; the API and workers scale horizontally when you need more.",
  },
  {
    question: "How is this different from the hosted automation tools?",
    answer:
      "Two ways. Self-hosting is the default rather than an enterprise tier, so your flow data and model keys stay in your own database. And the execution guarantees — idempotent retries, transactional job scheduling, sandboxed step code, per-tenant scoping — are design constraints from the first commit rather than features added once the bug reports arrive.",
  },
  {
    question: "What does it cost?",
    answer:
      "You run it, so you pay your own infrastructure and model bills and nothing else. There is no hosted plan today; if one appears it will be a convenience, not the only way to get the software.",
  },
];

export function Faq() {
  return (
    <Section
      id={config.webClient.landingSections.faq}
      eyebrow="FAQ"
      title="Reasonable questions, answered plainly"
      description="Including the one about whether this is finished. It is not, and pretending otherwise would waste your afternoon."
      layout="split"
    >
      <ul className="divide-y border-t border-b">
        {questions.map((item) => (
          <li key={item.question}>
            <details className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4">
                {item.question}
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 max-w-prose text-muted-foreground text-sm leading-relaxed">{item.answer}</p>
            </details>
          </li>
        ))}
      </ul>
    </Section>
  );
}
