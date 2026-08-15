import { createFileRoute } from "@tanstack/react-router";
import { CallToAction } from "@/components/landing/call-to-action";
import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { SelfHosting } from "@/components/landing/self-hosting";

function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Features />
      <SelfHosting />
      <Faq />
      <CallToAction />
    </>
  );
}

export const Route = createFileRoute("/")({
  component: LandingPage,
});
