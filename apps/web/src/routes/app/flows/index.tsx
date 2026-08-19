import { config, type Flow } from "@automend/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createFlow, deleteFlow, flowQueryKeys, listFlows } from "@/lib/flows-api";

const { routes } = config.webClient;
const { flowName } = config.validation;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function describeSize(flow: Flow): string {
  const stepCount = flow.definition.steps.length;

  return stepCount === 1 ? "1 step" : `${stepCount} steps`;
}

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <Input
        aria-label="Name of the new flow"
        placeholder="Name your flow"
        value={name}
        maxLength={flowName.maxLength}
        onChange={(event) => setName(event.target.value)}
        className="sm:max-w-xs"
      />
      <Button type="submit" size="lg" disabled={create.isPending || name.trim().length < flowName.minLength}>
        {create.isPending ? "Creating…" : "New flow"}
      </Button>

      {create.isError && (
        <p role="alert" className="self-center text-destructive text-sm">
          {create.error.message}
        </p>
      )}
    </form>
  );
}

function FlowCard({ flow }: { flow: Flow }) {
  const queryClient = useQueryClient();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const remove = useMutation({
    mutationFn: () => deleteFlow(flow.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: flowQueryKeys.lists() });
      toast.success(`Deleted "${flow.name}"`);
    },
    onError: (error) => toast.error("Could not delete the flow", { description: error.message }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Link
            to={routes.flowDetail}
            params={{ flowId: flow.id }}
            className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
          >
            {flow.name}
          </Link>
        </CardTitle>
        <CardDescription>
          {describeSize(flow)} · edited {dateFormat.format(new Date(flow.updatedAt))}
        </CardDescription>

        <CardAction>
          {isConfirmingDelete ? (
            <span className="flex items-center gap-1.5">
              <Button
                variant="destructive"
                size="sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
                autoFocus
              >
                {remove.isPending ? "Deleting…" : "Delete for good"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsConfirmingDelete(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setIsConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </CardAction>
      </CardHeader>

      {flow.description && <CardContent className="text-muted-foreground">{flow.description}</CardContent>}
    </Card>
  );
}

function FlowsPage() {
  const flows = useQuery({
    queryKey: flowQueryKeys.list(),
    queryFn: ({ signal }) => listFlows({}, signal),
  });

  return (
    <div className="animate-in fade-in duration-200 mx-auto w-full max-w-5xl flex-1 space-y-8 overflow-y-auto px-6 py-10">
      <div className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">Flows</h1>
        <p className="text-muted-foreground">Everything in this workspace. Open one to edit it on the canvas.</p>
      </div>

      <NewFlowForm />

      {flows.isPending && <p className="text-muted-foreground">Loading…</p>}

      {flows.isError && (
        <Card>
          <CardHeader>
            <CardTitle>Could not load your flows</CardTitle>
            <CardDescription>{flows.error.message}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {flows.data?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No flows yet</CardTitle>
            <CardDescription>
              Name one above and it opens with a trigger already in place — add steps from there.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="space-y-3">
        {flows.data?.map((flow) => (
          <FlowCard key={flow.id} flow={flow} />
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/app/flows/")({
  component: FlowsPage,
});
