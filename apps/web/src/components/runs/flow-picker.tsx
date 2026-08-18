import { config } from "@automend/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CheckIcon, ChevronDownIcon, LoaderCircleIcon, SearchIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { flowQueryKeys, getFlow, listFlows } from "@/lib/flows-api";
import { cn } from "@/lib/utils";

const { resultLimit, debounceMs, maxQueryLength } = config.flows.picker;

const EVERY_FLOW = "Every flow";

/** The name for a chosen flow, which the search results need not contain — it was chosen before a search. */
function useSelectedFlowName(flowId: string | undefined): string {
  const flow = useQuery({
    queryKey: flowQueryKeys.detail(flowId ?? ""),
    queryFn: ({ signal }) => getFlow(flowId ?? "", signal),
    enabled: flowId !== undefined,
  });

  if (!flowId) {
    return EVERY_FLOW;
  }

  return flow.data?.name ?? "Loading…";
}

export function FlowPicker({
  flowId,
  labelledBy,
  onChange,
}: {
  flowId: string | undefined;
  labelledBy?: string;
  onChange: (flowId: string | undefined) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  // Debounced, so holding a key down is one request rather than one per character.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), debounceMs);

    return () => clearTimeout(timer);
  }, [typed]);

  const query = { search: search || undefined, limit: resultLimit };

  const flows = useQuery({
    queryKey: flowQueryKeys.list(query),
    queryFn: ({ signal }) => listFlows(query, signal),
    enabled: open,
    // Keeps the previous results on screen while the next search is in flight, so the list does not
    // blank out under the pointer on every keystroke.
    placeholderData: keepPreviousData,
  });

  const options = [{ id: undefined, name: EVERY_FLOW }, ...(flows.data ?? []).map((flow) => ({ ...flow }))];
  const selectedName = useSelectedFlowName(flowId);

  function choose(id: string | undefined) {
    onChange(id);
    setOpen(false);
    setTyped("");
    setSearch("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      const step = event.key === "ArrowDown" ? 1 : -1;

      setActiveIndex((index) => (index + step + options.length) % options.length);
    }

    if (event.key === "Enter") {
      event.preventDefault();
      choose(options[activeIndex]?.id);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setActiveIndex(0);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="lg" aria-labelledby={labelledBy} className="w-52 justify-between font-normal">
          <span className="truncate">{selectedName}</span>
          <ChevronDownIcon className="shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
        <div className="flex items-center gap-2 border-b px-2.5">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            // biome-ignore lint/a11y/noAutofocus: the popover exists to be typed into
            autoFocus
            role="combobox"
            aria-expanded
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={`${listId}-${activeIndex}`}
            aria-label="Search flows by name"
            placeholder="Search flows…"
            value={typed}
            maxLength={maxQueryLength}
            onChange={(event) => {
              setTyped(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {flows.isFetching && <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        </div>

        {flows.isError && (
          <p role="alert" className="px-3 py-3 text-destructive text-xs leading-relaxed">
            Could not search flows. {flows.error.message}
          </p>
        )}

        {flows.isSuccess && options.length === 1 && (
          <p className="px-3 py-3 text-muted-foreground text-xs leading-relaxed">
            {search
              ? `No flow matches “${search}”. Try a shorter piece of the name.`
              : "This workspace has no flows yet."}
          </p>
        )}

        <div id={listId} role="listbox" aria-label="Flows" className="max-h-64 overflow-y-auto p-1">
          {options.map((option, index) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input owns the keyboard and points here with aria-activedescendant
            <div
              key={option.id ?? EVERY_FLOW}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={option.id === flowId}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                index === activeIndex ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option.id)}
            >
              <span className="truncate">{option.name}</span>
              {option.id === flowId && <CheckIcon className="ml-auto size-3.5 shrink-0" />}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
