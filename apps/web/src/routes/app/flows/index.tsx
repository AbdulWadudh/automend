import { config } from "@automend/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon, WorkflowIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { FlowCard } from "@/components/flows/flow-card";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { createFlow, flowQueryKeys, listFlows } from "@/lib/flows-api";

const { flowName } = config.validation;

function NewFlowForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => createFlow({ name: name.trim() }),
    onSuccess: async (created) => {
      setName("");
      await queryClient.invalidateQueries({ queryKey: flowQueryKeys.lists() });
      toast.success(`Created "${created.name}"`);
    },
    onError: (error) => toast.error("Could not create the flow", { description: error.message }),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (name.trim().length >= flowName.minLength) {
      create.mutate();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        aria-label="Name of the new flow"
        placeholder="Name your flow"
        value={name}
        maxLength={flowName.maxLength}
        onChange={(event) => setName(event.target.value)}
        className="sm:w-64"
      />
      <Button type="submit" disabled={create.isPending || name.trim().length < flowName.minLength}>
        <PlusIcon />
        {create.isPending ? "Creating…" : "New flow"}
      </Button>

      {create.isError && (
        <p role="alert" className="text-destructive text-sm sm:self-center">
          {create.error.message}
        </p>
      )}
    </form>
  );
}

/** Shaped like the card it stands in for, so nothing moves when the real ones arrive. */
function FlowCardSkeleton() {
  return (
    <div className="rounded-xl border p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="mt-6 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>
  );
}

function FlowsPage() {
  const flows = useQuery({
    queryKey: flowQueryKeys.list(),
    queryFn: ({ signal }) => listFlows({}, signal),
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="animate-in fade-in duration-200 mx-auto w-full max-w-6xl space-y-6 px-4 pt-6 pb-10 sm:px-6 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-semibold text-2xl tracking-tight">Flows</h1>
            <p className="text-muted-foreground">Everything in this workspace. Open one to edit it on the canvas.</p>
          </div>

          <NewFlowForm />
        </div>

        {flows.isPending && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
            <span className="sr-only">Loading your flows…</span>
            {Array.from({ length: 6 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity to key by.
              <FlowCardSkeleton key={index} />
            ))}
          </div>
        )}

        {flows.isError && (
          <Card>
            <CardHeader>
              <CardTitle>Could not load your flows</CardTitle>
              <CardDescription>{flows.error.message}</CardDescription>
            </CardHeader>
            <CardHeader>
              <Button size="sm" variant="outline" className="w-fit" onClick={() => void flows.refetch()}>
                Try again
              </Button>
            </CardHeader>
          </Card>
        )}

        {flows.data?.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
            <WorkflowIcon className="size-8 text-muted-foreground" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">No flows yet</p>
              <p className="max-w-sm text-muted-foreground text-sm">
                Name one above and it opens with a trigger already in place — add steps from there.
              </p>
            </div>
          </div>
        )}

        {flows.data && flows.data.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {flows.data.map((flow) => (
              <FlowCard key={flow.id} flow={flow} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/app/flows/")({
  component: FlowsPage,
});
