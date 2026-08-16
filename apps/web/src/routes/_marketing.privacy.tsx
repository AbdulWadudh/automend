import { config } from "@automend/shared";
import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";

const { productName, legalEntityName, domain, emails } = config.company;

const sections: LegalSection[] = [
  {
    heading: "Who this policy covers",
    paragraphs: [
      `This policy explains how ${legalEntityName} ("we", "us") handles personal data on the ${domain} website and in the ${productName} software.`,
      `The distinction matters more here than for most services. ${productName} is self-hosted: you run it on your own servers, against your own database. When you do, the flows you build, the data they process and the credentials they use are stored by you, on your infrastructure, and we never receive them. For that data you are the controller and we are not a processor — we have no access to it at all.`,
      `We are the controller only for the limited information described below, which comes from visiting this website or contacting us directly.`,
    ],
  },
  {
    heading: "Information we collect",
    paragraphs: ["On this website, we collect only what is needed to keep it running and to answer you:"],
    bullets: [
      "Technical request data — IP address, browser type, referring page and the pages you request. This is produced automatically by the web server and used to serve the site and diagnose faults.",
      "Diagnostic events from the page itself — errors and performance measurements, sent to a collector we operate. These describe how the page behaved, not who you are.",
      "Anything you send us — the content of an email you write to us, along with your address, so we can reply.",
    ],
    closing: [
      "We do not run advertising or cross-site tracking, we do not sell personal data, and there is no account to create on this website.",
    ],
  },
  {
    heading: "What the software collects when you run it",
    paragraphs: [
      "A deployment you operate stores what it needs to do its job: the flows you define, the history of each run and its steps, the credentials you connect to third-party services, and application logs. Credentials are envelope-encrypted before they are written to the database and are redacted from log output.",
      `All of it lives in your database, on your infrastructure. ${productName} makes no outbound requests of its own — the only calls that leave your network are the ones your own flows make, to the APIs and AI models you configured. Nothing reports back to us.`,
    ],
  },
  {
    heading: "How we use information",
    bullets: [
      "To operate, secure and troubleshoot this website.",
      "To respond to support, security or privacy enquiries you send us.",
      "To understand which pages are read, in aggregate, so the documentation improves.",
      "To meet legal obligations, and to establish or defend legal claims where necessary.",
    ],
  },
  {
    heading: "Legal bases for processing",
    paragraphs: [
      "Where the UK GDPR or EU GDPR applies, we rely on our legitimate interests in operating and securing a website and in answering the people who write to us; on the necessity of processing to take steps at your request before entering a contract; and on compliance with legal obligations where one applies. Where we ever rely on consent, you may withdraw it at any time.",
    ],
  },
  {
    heading: "Sharing and service providers",
    paragraphs: [
      "We share personal data only with providers that host this website and its telemetry collector, and then only as far as they need it to provide that service. They act on our instructions and may not use the data for their own purposes.",
      "We may also disclose information where we are legally required to, or where it is necessary to investigate abuse or protect the rights and safety of others. If our business is ever transferred to another entity, information would move with it and this policy would continue to apply until you are told otherwise.",
    ],
  },
  {
    heading: "Retention",
    paragraphs: [
      "Server and diagnostic records are kept only as long as they are useful for security and debugging, and are deleted on a rolling basis. Correspondence is kept for as long as needed to handle the matter and to keep a record of it afterwards. Data held in your own deployment is retained according to your policies, not ours.",
    ],
  },
  {
    heading: "Security",
    paragraphs: [
      "We use encryption in transit, restricted access and current patching for the infrastructure we operate. No system is perfectly secure, so we do not claim otherwise — but if you believe you have found a vulnerability, please tell us before you tell anyone else.",
    ],
    closing: [`Report security issues to ${emails.security}. We will acknowledge your report and keep you updated.`],
  },
  {
    heading: "International transfers",
    paragraphs: [
      "Our providers may process data in countries other than yours. Where personal data is transferred out of the UK or the EEA, we rely on an adequacy decision or on standard contractual clauses with appropriate safeguards.",
    ],
  },
  {
    heading: "Your rights",
    paragraphs: [
      "Depending on where you live, you may have the right to request access to your personal data, correction of it, deletion of it, restriction of or objection to its processing, and a portable copy. You may also lodge a complaint with your local supervisory authority.",
      `To exercise any of these, write to ${emails.privacy}. Note that for data inside a deployment someone else operates, your request needs to go to whoever runs it — we cannot reach it.`,
    ],
  },
  {
    heading: "Children",
    paragraphs: [
      "This website and the software are intended for people building software professionally, and are not directed at children under 16. We do not knowingly collect their personal data; if you believe we have, contact us and we will delete it.",
    ],
  },
  {
    heading: "Changes to this policy",
    paragraphs: [
      "If this policy changes materially, we will update the effective date at the top of this page and, where the change is significant, note it in the project's changelog. Continuing to use the website after a change means you accept the updated policy.",
    ],
  },
  {
    heading: "Contact us",
    paragraphs: [
      `Privacy questions and rights requests: ${emails.privacy}. Security reports: ${emails.security}. Anything else: ${emails.support}.`,
    ],
  },
];

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      summary={`${productName} is software you host yourself, so the data your flows touch never reaches us. This policy covers the little we do handle — and is specific about the difference.`}
      sections={sections}
    />
  );
}

export const Route = createFileRoute("/_marketing/privacy")({
  component: PrivacyPage,
});
