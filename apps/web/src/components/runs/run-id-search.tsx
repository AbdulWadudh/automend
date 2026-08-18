import { config } from "@automend/shared";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const { routes, runIdParam } = config.webClient;

/** Anywhere in the input, so a pasted run URL works as well as a bare id. */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function RunIdSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const found = UUID_PATTERN.exec(value.trim());

    if (!found) {
      setProblem("That is not a run id. Paste the whole id — the copy button on a run gives you one.");
      return;
    }

    setProblem(undefined);
    setValue("");
    await navigate({ to: routes.runDetail, params: { [runIdParam]: found[0] } });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      <Label htmlFor="run-id-search" className="text-xs">
        Open a run by id
      </Label>

      <div className="flex items-center gap-1.5">
        <Input
          id="run-id-search"
          value={value}
          spellCheck={false}
          aria-invalid={problem !== undefined}
          aria-describedby={problem ? "run-id-search-problem" : undefined}
          placeholder="Paste a run id"
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(undefined);
          }}
          className="w-56 font-mono text-xs"
        />
        <Button type="submit" size="icon" variant="outline" aria-label="Open this run" disabled={value.trim() === ""}>
          <ArrowRightIcon />
        </Button>
      </div>

      {problem && (
        <p id="run-id-search-problem" role="alert" className="max-w-56 text-destructive text-xs leading-relaxed">
          {problem}
        </p>
      )}
    </form>
  );
}
