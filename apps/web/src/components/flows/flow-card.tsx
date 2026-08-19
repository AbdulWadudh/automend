import { config, type FlowListItem } from "@automend/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleDashedIcon, HistoryIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { IconAction } from "@/components/ui/icon-action";
import { accentForKit, iconForMember } from "@/lib/flow-kinds";
import { deleteFlow, flowQueryKeys } from "@/lib/flows-api";
import { cn } from "@/lib/utils";

const { routes, flowIdParam } = config.webClient;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** Recent activity reads better as "2 hours ago" than as a date; anything older reads better as the date. */
function describeWhen(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);

  if (minutes > -60) {
    return relativeFormat.format(minutes, "minute");
  }

  const hours = Math.round(minutes / 60);

  return hours > -48 ? relativeFormat.format(hours, "hour") : dateFormat.format(new Date(iso));
}

/**
 * Whether this flow has ever run.
 *
 * A badge, not a chip: it reports state the workspace owns rather than a value anybody can act on, so
 * it is a `span` and not a link. The icon carries the meaning and the tint reinforces it — a row of
 * cards distinguished only by hue is unreadable to a good number of people.
 *
 * It sits beside the control rather than being the control. Making the badge itself a link is what
 * hid the way into the runs: a chip that reports state and a chip that navigates look identical.
 */
function RunBadge({ lastRunAt }: { lastRunAt: string | null }) {
  const hasRun = lastRunAt !== null;
  const Icon = hasRun ? PlayIcon : CircleDashedIcon;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs",
        hasRun ? "bg-node-emerald/15 text-node-emerald" : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {hasRun ? `Ran ${describeWhen(lastRunAt)}` : "Never run"}
    </span>
  );
}

/**
 * The way into this flow's runs, and it is always here.
 *
 * Present even when the flow has never run: one card with a button beside one without reads as the
 * feature being missing rather than as a state, and an empty feed is itself the answer to "has this
 * ever done anything". The badge beside it is what says which.
 *
 * `relative z-10` because the card's title link is stretched over the whole surface — without it this
 * sits underneath and the card's own link swallows the press.
 */
function RunsLink({ flow }: { flow: FlowListItem }) {
  return (
    <Button asChild size="xs" variant="outline" className="relative z-10 shrink-0">
      <Link to={routes.runs} search={{ flowId: flow.id }} aria-label={`Runs of ${flow.name}`}>
        <HistoryIcon data-icon="inline-start" />
        Runs
      </Link>
    </Button>
  );
}

export function FlowCard({ flow }: { flow: FlowListItem }) {
  const queryClient = useQueryClient();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const { trigger, steps } = flow.definition;
  const accent = accentForKit(trigger.kitId);
  const TriggerIcon = iconForMember(trigger.kitId, trigger.triggerName);

  const remove = useMutation({
    mutationFn: () => deleteFlow(flow.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: flowQueryKeys.lists() });
      toast.success(`Deleted "${flow.name}"`);
    },
    onError: (error) => toast.error("Could not delete the flow", { description: error.message }),
  });

  return (
    <Card className="group relative flex flex-col transition hover:-translate-y-0.5 hover:bg-muted/20">
      <CardHeader className="gap-3">
        <div className="flex items-start gap-3">
          {/* The kit's own accent, so a flow started by Gmail looks the same here as it does on the canvas. */}
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", accent.chip)}>
            <TriggerIcon className="size-4.5" aria-hidden />
          </span>

          <div className="min-w-0 flex-1 space-y-0.5">
            <CardTitle className="text-base leading-snug">
              {/*
                One real link, stretched over the card with `after:inset-0`, rather than a link per
                region or a click handler on the card: the whole surface becomes the target while
                there is still exactly one thing in the tab order that says where it goes.
              */}
              <Link
                to={routes.flowDetail}
                params={{ [flowIdParam]: flow.id }}
                className="rounded-sm after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
              >
                {flow.name}
              </Link>
            </CardTitle>

            <p className="truncate text-muted-foreground text-xs">
              {trigger.kitId}.{trigger.triggerName}
            </p>
          </div>

          {/*
            Above the stretched link, or it would be unreachable beneath it. Kept out of the way until
            the card is hovered or something inside it has focus, so a wall of cards is not a wall of
            delete buttons — `focus-within` is what keeps it reachable from the keyboard.
          */}
          <IconAction
            label={`Delete ${flow.name}`}
            tone="danger"
            onClick={() => setIsConfirmingDelete(true)}
            className="relative z-10 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Trash2Icon />
          </IconAction>
        </div>
      </CardHeader>

      {flow.description && (
        <CardContent>
          <p className="line-clamp-2 text-muted-foreground text-sm">{flow.description}</p>
        </CardContent>
      )}

      {/*
        Two fixed rows rather than one that wraps.
        
        Wrapping made the footer's height depend on how long "edited 8 hours ago" happened to be, so a
        card with a short meta line kept everything on one row and its neighbour pushed the badge onto a
        second — two cards side by side with different shapes. The rows are always the rows.
      */}
      <CardFooter className="mt-auto flex-col items-stretch gap-2.5 border-t pt-4">
        <span className="text-muted-foreground text-xs tabular-nums">
          {steps.length === 1 ? "1 step" : `${steps.length} steps`} · edited {describeWhen(flow.updatedAt)}
        </span>

        <span className="flex items-center justify-between gap-2">
          <RunBadge lastRunAt={flow.lastRunAt} />
          <RunsLink flow={flow} />
        </span>
      </CardFooter>

      {/*
        A dialog rather than the row swapping itself for two buttons: deleting a flow takes its runs
        with it, and a confirmation for something permanent gets words and a moment of its own.
      */}
      <AlertDialog open={isConfirmingDelete} onOpenChange={setIsConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{flow.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the flow and everything it has ever run. There is no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            {/* The dialog's confirming action is the destructive one, so it wears the destructive
                variant. Defaulting to `default` painted a permanent removal in the brand colour —
                the same green as every safe primary action in the app. */}
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                // The dialog closes itself on action; the mutation has to outlive that close.
                event.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete for good"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
