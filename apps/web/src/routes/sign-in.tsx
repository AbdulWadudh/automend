import { config } from "@automend/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthPanel } from "@/components/auth/auth-panel";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { SocialSignIn } from "@/components/auth/social-sign-in";
import { resolveRedirectTarget } from "@/lib/redirects";

const { routes, redirectSearchParam } = config.webClient;

function SignInPage() {
  const search = Route.useSearch();
  const redirectTo = resolveRedirectTarget(search[redirectSearchParam]);

  return (
    <AuthPanel
      title="Sign in"
      subtitle="Pick up where you left off with your flows."
      footer={
        <>
          New here?{" "}
          <Link to={routes.signUp} className="text-foreground underline underline-offset-4">
            Create an account
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <SocialSignIn redirectTo={redirectTo} />
        <CredentialsForm mode="sign-in" redirectTo={redirectTo} />
      </div>
    </AuthPanel>
  );
}

export const Route = createFileRoute("/sign-in")({
  // Typed as optional rather than "string | undefined", so linking here does not oblige every
  // caller to pass a redirect it does not have.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search[redirectSearchParam] === "string" ? { redirect: search[redirectSearchParam] } : {},
  component: SignInPage,
});
