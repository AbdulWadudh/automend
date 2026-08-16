import { config } from "@automend/shared";
import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";

const { productName, legalEntityName, domain, emails, legal } = config.company;
const { routes } = config.webClient;

const sections: LegalSection[] = [
  {
    heading: "Agreement to these terms",
    paragraphs: [
      `These terms are an agreement between you and ${legalEntityName} covering the ${domain} website and the ${productName} software. By using either, you accept them. If you are accepting on behalf of an organisation, you confirm you are authorised to bind it, and "you" means that organisation.`,
      "If you do not accept these terms, do not use the website or the software.",
    ],
  },
  {
    heading: "What Automend is",
    paragraphs: [
      `${productName} is a workflow automation platform you deploy and operate yourself. It executes flows you define: triggers, steps, branches and loops, including steps that call AI models using credentials you supply.`,
      "We provide the software and this website. We do not operate your deployment, hold your data, or act as a party to anything your flows do on your behalf.",
    ],
  },
  {
    heading: "Early access",
    paragraphs: [
      `${productName} is in active development and is offered in early access. Parts of it are incomplete, interfaces change without notice, and defects should be expected. It is not yet suitable for workloads where failure carries real cost.`,
      "Evaluate it against your own requirements before relying on it. Nothing on this website is a commitment that a feature will ship, or ship on any particular date.",
    ],
  },
  {
    heading: "The software licence",
    paragraphs: [
      "Your rights to copy, modify, deploy and distribute the software are granted by the licence file distributed with the source code, not by these terms. Where the two differ about the software itself, that licence governs.",
      "These terms otherwise apply to your use of this website and to the relationship between us.",
    ],
  },
  {
    heading: "Your responsibilities",
    bullets: [
      "Operating your deployment: hosting, access control, backups, updates and security patching are yours.",
      "Everything your flows do — the requests they send, the messages they deliver and the changes they make in other systems — is attributed to you.",
      "Keeping credentials safe. If a key you configured is compromised, rotate it at the provider; we cannot do it for you.",
      "Complying with the terms of every third-party service and AI model your flows call, and with the laws that apply to the data you process.",
    ],
  },
  {
    heading: "Acceptable use",
    paragraphs: ["You agree not to use the website or the software to:"],
    bullets: [
      "Break the law, infringe someone's rights, or process data you have no right to process.",
      "Send unsolicited bulk messages, or automate abuse, harassment or fraud against anyone.",
      "Attack or overload infrastructure — ours, a third party's, or another tenant's on a shared deployment.",
      "Circumvent access controls, tenant boundaries, or the isolation applied to step execution.",
      "Misrepresent AI-generated output as human, where doing so would deceive someone to their detriment.",
    ],
  },
  {
    heading: "Your content and flows",
    paragraphs: [
      "Your flow definitions, data and run history are yours. We claim no ownership of them and, because you host them, we hold no copy of them.",
      "If you choose to send us content — a bug report, a log excerpt, a support email — you give us permission to use it for the purpose of helping you and of fixing the underlying problem. Remove anything sensitive before you send it.",
    ],
  },
  {
    heading: "Third-party services and AI models",
    paragraphs: [
      "Flows commonly call services we do not control, including AI providers. Those calls are governed by your agreement with each provider, are billed by them, and are subject to their availability and their content policies.",
      "AI output can be wrong, biased or fabricated, and can vary between identical runs. Do not use it as the sole basis for a decision with legal, financial, medical or safety consequences without a human reviewing it. We are not responsible for the output of a model you chose to call.",
    ],
  },
  {
    heading: "Fees",
    paragraphs: [
      "Self-hosting is free of charge under these terms. You are responsible for your own infrastructure costs and for what your model and API providers bill you.",
      "If a paid service is offered in future, its pricing and terms will be presented before you buy anything, and they will not apply retroactively to a deployment you already run.",
    ],
  },
  {
    heading: "Intellectual property",
    paragraphs: [
      `The ${productName} name, logo and the content of this website belong to ${legalEntityName}. Rights in the source code are governed by its licence. Nothing here transfers ownership of our trademarks, and you may not use them in a way that suggests we endorse or produced something we did not.`,
    ],
  },
  {
    heading: "Suspension and termination",
    paragraphs: [
      "You may stop using the website and the software at any time; shutting down your own deployment is entirely in your hands.",
      "We may restrict access to this website, or to services we operate, if it is being used in breach of these terms or in a way that harms others. The sections on intellectual property, disclaimers, liability, indemnity and governing law survive termination.",
    ],
  },
  {
    heading: "Disclaimer of warranties",
    paragraphs: [
      'The website and the software are provided "as is" and "as available", without warranty of any kind, express or implied, including any implied warranty of merchantability, fitness for a particular purpose, title or non-infringement.',
      "We do not warrant that the software is free of defects, that it will run without interruption, that a flow will execute at a particular time, or that any data will be preserved. Where your jurisdiction does not allow a warranty to be excluded, it is limited to the shortest period the law permits.",
    ],
  },
  {
    heading: "Limitation of liability",
    paragraphs: [
      "To the fullest extent the law allows, we are not liable for indirect, incidental, special, consequential or punitive damages, nor for lost profits, lost revenue, lost data, or business interruption — however caused, and even if we were told such damage was possible.",
      "Our total aggregate liability arising out of or relating to these terms is limited to the greater of the amount you paid us in the twelve months before the claim, or one hundred US dollars.",
      "Nothing in these terms excludes liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for anything else that cannot lawfully be excluded.",
    ],
  },
  {
    heading: "Indemnity",
    paragraphs: [
      "You will indemnify and hold us harmless against claims, damages and reasonable legal costs arising from your use of the software, from what your flows do, or from your breach of these terms — except to the extent the claim results from our own wrongdoing.",
    ],
  },
  {
    heading: "Governing law",
    paragraphs: [
      `These terms are governed by the laws of ${legal.governingLaw}, without regard to conflict-of-law rules, and the courts of ${legal.governingLaw} have exclusive jurisdiction over any dispute. If you are a consumer, this does not deprive you of the protection of mandatory rules in your country of residence.`,
    ],
  },
  {
    heading: "Changes to these terms",
    paragraphs: [
      "We may update these terms as the project develops. The effective date at the top of this page changes when we do, and material changes are noted in the project's changelog. Continuing to use the website or the software after that date means you accept the revised terms.",
    ],
  },
  {
    heading: "Contact",
    paragraphs: [
      `Questions about these terms: ${emails.support}. Security reports: ${emails.security}. How we handle personal data is described in our privacy policy at ${routes.privacy}.`,
    ],
  },
];

function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      summary={`The terms you accept by using ${domain} and the ${productName} software. Short version: it is early-access software you run yourself, it comes with no warranty, and what your flows do is your responsibility.`}
      sections={sections}
    />
  );
}

export const Route = createFileRoute("/_marketing/tos")({
  component: TermsPage,
});
