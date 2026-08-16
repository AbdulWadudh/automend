import { config } from "@automend/shared";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const { routes } = config.webClient;

/**
 * The frame both sign-in and sign-up sit in.
 *
 * Neither page uses the marketing header: at this point the visitor is trying to get in, and a
 * navigation bar full of other destinations is only in the way. The wordmark still links home.
 */
export function AuthPanel({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-4">
          <Link
            to={routes.home}
            className="inline-flex items-center gap-2.5 rounded-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
          >
            <img src="/logo.webp" alt="" width={32} height={20} className="h-5 w-auto" />
            {config.company.productName}
          </Link>

          <div className="space-y-1.5">
            <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          </div>
        </div>

        {children}

        <p className="text-center text-muted-foreground text-sm">{footer}</p>
      </div>
    </main>
  );
}
