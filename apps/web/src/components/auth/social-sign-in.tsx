import { authProvidersSchema, config } from "@automend/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { requestApi } from "@/lib/api";
import { signIn } from "@/lib/auth-client";

const googleProvider = config.auth.socialProviders.google;

/** Relative to the versioned base path, which `requestApi` prefixes — as in `flows-api.ts`. */
const AUTH_PROVIDERS_PATH = "/auth-providers";

/**
 * Asked at runtime rather than compiled in: whether a provider is usable depends on credentials
 * the container was started with, and a button that redirects to a provider we have no client id
 * for is worse than no button.
 */
function useEnabledSocialProviders() {
  return useQuery({
    queryKey: ["auth", "providers"],
    queryFn: ({ signal }) => requestApi({ path: AUTH_PROVIDERS_PATH, schema: authProvidersSchema, signal }),
  });
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <title>Google</title>
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.55Z"
      />
      <path
        fill="#34A853"
        d="M12 23.5c3.11 0 5.72-1.03 7.62-2.8l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.74H1.71v2.98A11.5 11.5 0 0 0 12 23.5Z"
      />
      <path fill="#FBBC05" d="M5.55 14.17a6.9 6.9 0 0 1 0-4.34V6.85H1.71a11.5 11.5 0 0 0 0 10.3l3.84-2.98Z" />
      <path
        fill="#EA4335"
        d="M12 5.09c1.69 0 3.2.58 4.4 1.72l3.29-3.29C17.71 1.62 15.1.5 12 .5A11.5 11.5 0 0 0 1.71 6.85l3.84 2.98C6.46 7.11 9 5.09 12 5.09Z"
      />
    </svg>
  );
}

export function SocialSignIn({ redirectTo }: { redirectTo: string }) {
  const providers = useEnabledSocialProviders();
  const [isRedirecting, setIsRedirecting] = useState(false);

  if (!providers.data?.social.includes(googleProvider.id)) {
    return null;
  }

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        disabled={isRedirecting}
        onClick={() => {
          setIsRedirecting(true);
          // The browser leaves for the provider and comes back to `callbackURL`, so there is no
          // success path to handle here — only the failure to start the redirect at all.
          void signIn
            .social({ provider: googleProvider.id, callbackURL: redirectTo })
            .catch(() => setIsRedirecting(false));
        }}
      >
        <GoogleMark />
        Continue with {googleProvider.label}
      </Button>

      <div className="flex items-center gap-3 text-muted-foreground text-xs">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
