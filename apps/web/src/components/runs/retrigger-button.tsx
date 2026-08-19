import { config, isTerminalRunStatus, type RunRetrySummary, type RunStatus } from "@automend/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircleIcon, RotateCcwIcon } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { flowQueryKeys } from "@/lib/flows-api";
import { retriggerRun, runQueryKeys } from "@/lib/runs-api";

const { routes, runIdParam } = config.webClient;

export type RetriggerButtonProps = {
  runId: string;
  status: RunStatus;
  retries: RunRetrySummary;
  size?: "xs" | "sm";
  variant?: "outline" | "ghost" | "default";
  onStarted?: (runId: string) => void;
};

/**
 * Starts the flow again with the data this run received, then opens the new run.
 *
 * Hidden rather than disabled while the run is unfinished: the API refuses it, and an always-visible
 * control that is dead half the time trains people to ignore it.
 */
export function RetriggerButton({
  runId,
  status,
  retries,
  size = "sm",
  variant = "outline",
  onStarted,
}: RetriggerButtonProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /**
   * Names one press of this button. Two submits that share it resolve to a single run, and rotating it
   * afterwards is what keeps a deliberate second retrigger from being swallowed as a duplicate — the
   * server cannot tell the two apart, because the requests are identical.
   */
  const gestureToken = useRef(crypto.randomUUID());

  const retrigger = useMutation({
    mutationFn: () => retriggerRun(runId, gestureToken.current),
    onSuccess: async (started) => {
      gestureToken.current = crypto.randomUUID();

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: runQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: flowQueryKeys.all }),
      ]);
      if (onStarted) {
        onStarted(started.runId);
      } else {
        await navigate({ to: routes.runDetail, params: { [runIdParam]: started.runId } });
      }

      toast.success(started.duplicate ? "That run was already started" : "Started a new run", {
        description: started.duplicate ? "Opened the one it resolved to." : "Running with the same data as before.",
      });
    },
    onError: (error) => toast.error("Could not start it again", { description: error.message }),
  });

  if (!isTerminalRunStatus(status)) {
    return null;
  }

  const retryInFlight = retries.latestStatus !== null && !isTerminalRunStatus(retries.latestStatus);
  const alreadySucceeded = status === "succeeded" || retries.latestStatus === "succeeded";

  const button = (onClick?: () => void) => (
    <Button
      size={size}
      variant={variant}
      disabled={retrigger.isPending || retryInFlight}
      onClick={onClick}
      title={retryInFlight ? "A run started from this one is still going" : undefined}
    >
      {retrigger.isPending ? (
        <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
      ) : (
        <RotateCcwIcon data-icon="inline-start" />
      )}
      {retrigger.isPending ? "Starting…" : "Run again"}
    </Button>
  );

  const failure = retrigger.isError && (
    <span role="alert" className="max-w-xs text-right text-destructive text-xs">
      {retrigger.error.message}
    </span>
  );

  /**
   * Asks first whenever running it again would repeat work that already came off: this run succeeded,
   * or a run started from it did. A failure nobody has fixed yet has nothing to repeat, so that case —
   * the common one — goes straight through.
   */
  if (alreadySucceeded && !retryInFlight) {
    return (
      <span className="flex flex-col items-end gap-1">
        <AlertDialog>
          <AlertDialogTrigger asChild>{button()}</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Run this again?</AlertDialogTitle>
            <AlertDialogDescription>
              {status === "succeeded"
                ? "This run succeeded, so everything it did happens a second time — any email it sent is sent again, anything it created is created again."
                : `You have already run this ${retries.count === 1 ? "once" : `${retries.count} times`}, and the last attempt succeeded. Running it again repeats that work.`}{" "}
              It runs against the flow as it is now, with the same data it received the first time.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => retrigger.mutate()}>Run it again</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {failure}
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      {button(() => retrigger.mutate())}

      {retryInFlight && <span className="text-muted-foreground text-xs">A retry is still running</span>}

      {failure}
    </span>
  );
}
