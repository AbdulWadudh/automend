import { config } from "@automend/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthPanel } from "@/components/auth/auth-panel";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { SocialSignIn } from "@/components/auth/social-sign-in";
import { resolveRedirectTarget } from "@/lib/redirects";

const { routes, redirectSearchParam } = config.webClient;

function SignUpPage() {
  const search = Route.useSearch();
  const redirectTo = resolveRedirectTarget(search[redirectSearchParam]);

  return (
    <AuthPanel
      title="Create your account"
      subtitle={`A workspace is created with it, so you can build a flow straight away.`}
      footer={
        <>
          Already have an account?{" "}
          <Link to={routes.signIn} className="text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <SocialSignIn redirectTo={redirectTo} />
        <CredentialsForm mode="sign-up" redirectTo={redirectTo} />
      </div>
    </AuthPanel>
  );
}

export const Route = createFileRoute("/sign-up")({
  // Typed as optional rather than "string | undefined", so linking here does not oblige every
  // caller to pass a redirect it does not have.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search[redirectSearchParam] === "string" ? { redirect: search[redirectSearchParam] } : {},
  component: SignUpPage,
});
