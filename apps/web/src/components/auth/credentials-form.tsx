import { config } from "@automend/shared";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "@/lib/auth-client";

const { password: passwordRules, userName } = config.validation;

export type CredentialsMode = "sign-in" | "sign-up";

/**
 * Email and password, for both signing in and signing up.
 *
 * One component rather than two because the pages differ only in which endpoint they call and what
 * the button says — and keeping them together is what stops the two forms drifting apart in their
 * validation rules.
 */
export function CredentialsForm({ mode, redirectTo }: { mode: CredentialsMode; redirectTo: string }) {
  const navigate = useNavigate();
  const isSignUp = mode === "sign-up";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(undefined);
    setIsSubmitting(true);

    const result = isSignUp ? await signUp.email({ name, email, password }) : await signIn.email({ email, password });

    if (result.error) {
      // Better-Auth's own message is shown as-is: it already distinguishes a wrong password from
      // an address that is not registered, without saying which.
      setProblem(result.error.message ?? "That did not work. Please try again.");
      setIsSubmitting(false);
      return;
    }

    await navigate({ href: redirectTo });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate={false}>
      {isSignUp && (
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            required
            maxLength={userName.maxLength}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          minLength={passwordRules.minLength}
          maxLength={passwordRules.maxLength}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={isSignUp ? "password-hint" : undefined}
        />
        {isSignUp && (
          <p id="password-hint" className="text-muted-foreground text-xs">
            At least {passwordRules.minLength} characters.
          </p>
        )}
      </div>

      {problem && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {problem}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}
