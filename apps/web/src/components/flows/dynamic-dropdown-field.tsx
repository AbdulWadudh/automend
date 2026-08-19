/**
 * A dropdown whose choices come from the service, not from the kit.
 *
 * The list is fetched through the API, which runs the kit's loader in the same subprocess a step runs
 * in — so nothing about the service, its addresses or its credential reaches this bundle. What arrives
 * here is a list of labels, values and qualifiers.
 *
 * A searchable combobox rather than a `Select`, because the list is fetched and may be long: the cap is
 * a thousand options, and scrolling a thousand channels to find one is not choosing, it is hunting.
 * `Command` brings the parts that are easy to get wrong — the combobox roles, `aria-activedescendant`
 * tracking the arrow keys, and Escape — which is why it is used instead of assembling one from divs.
 *
 * All four asynchronous states are designed, because this one genuinely has all four: loading while the
 * service answers, empty when the workspace has nothing to choose, in error when the call failed, and
 * populated otherwise. A spinner alone is not an empty state.
 */

import type { KitProperty } from "@automend/kit-framework";
import type { LoadPropertyOptionsRequest, PropertyOption } from "@automend/shared";
import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  LoaderCircleIcon,
  LockIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { findUnmetDependencies, isStaleSelection, narrowToDependencies } from "@/lib/dynamic-options";
import { kitQueryKeys, loadPropertyOptions } from "@/lib/kits-api";
import { cn } from "@/lib/utils";

/** Where the choices come from — everything the API needs to resolve the loader and act as someone. */
export type OptionsSource = {
  kitId: string;
  target: "action" | "trigger";
  targetName: string;
  /** Undefined until the author has chosen an account, which is a normal state rather than an error. */
  connectionId: string | undefined;
  /** The step as configured so far, for a dropdown that narrows another. */
  input: Record<string, unknown>;
};

export type DynamicDropdownFieldProps = {
  property: KitProperty;
  source: OptionsSource;
  fieldId: string;
  describedBy: string | undefined;
  invalid: boolean;
  value: string;
  onChange: (value: string) => void;
};

export function DynamicDropdownField({
  property,
  source,
  fieldId,
  describedBy,
  invalid,
  value,
  onChange,
}: DynamicDropdownFieldProps) {
  const [open, setOpen] = useState(false);
  const noun = property.displayName.toLowerCase();
  const dependsOn = property.dependsOn ?? [];
  const unmetDependencies = findUnmetDependencies(source.input, dependsOn);
  const request: LoadPropertyOptionsRequest = {
    kitId: source.kitId,
    target: source.target,
    targetName: source.targetName,
    propertyName: property.name,
    connectionId: source.connectionId ?? "",
    input: narrowToDependencies(source.input, dependsOn),
  };

  const canLoad = source.connectionId !== undefined && unmetDependencies.length === 0;
  const query = useQuery({
    queryKey: kitQueryKeys.options(request),
    queryFn: ({ signal }) => loadPropertyOptions(request, signal),
    enabled: canLoad,
    // The service's own list: it changes when somebody creates a channel, not when somebody clicks, so
    // refetching on every focus would be a request per interaction. Refresh below is the manual way.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!canLoad) {
    return (
      <Notice fieldId={fieldId} describedBy={describedBy}>
        {source.connectionId === undefined
          ? "Choose a connection above to load the list."
          : `Fill in ${unmetDependencies.join(" and ")} first — the list depends on it.`}
      </Notice>
    );
  }

  if (query.isPending) {
    return (
      <div
        id={fieldId}
        aria-describedby={describedBy}
        aria-busy="true"
        className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-muted-foreground text-sm"
      >
        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        Loading {noun}…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-2">
        {/* An icon and words beside the colour, because a red border alone says nothing to a lot of people. */}
        <p
          id={fieldId}
          role="alert"
          aria-describedby={describedBy}
          className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-destructive text-xs leading-relaxed"
        >
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {query.error instanceof Error ? query.error.message : "The list could not be loaded."}
        </p>
        {/* An error offers a way forward, rather than only saying that something went wrong. */}
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          <RotateCcwIcon data-icon="inline-start" />
          Try again
        </Button>
      </div>
    );
  }

  const options = query.data.options;
  const selected = options.find((option) => option.value === value);
  const isStale = isStaleSelection(value, options);

  if (options.length === 0) {
    return (
      <div className="space-y-2">
        <Notice fieldId={fieldId} describedBy={describedBy}>
          This connection can see no {noun} yet. Create one in the service, then refresh.
        </Notice>
        <RefreshButton isFetching={query.isFetching} noun={noun} onRefresh={() => void query.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={fieldId}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-describedby={describedBy}
            aria-invalid={invalid || isStale || undefined}
            className="w-full justify-between font-normal"
          >
            {selected ? (
              <OptionLabel option={selected} />
            ) : (
              <span className="text-muted-foreground">{value === "" ? `Choose a ${noun}` : value}</span>
            )}
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>

        {/* Matched to the trigger, so the list never spills out of a narrow inspector panel. */}
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${noun}…`} />
            <CommandList>
              {/* A dead end with a way out, rather than a blank list. */}
              <CommandEmpty>No {noun} matches that. Try part of the name, or refresh below.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    // Searched on all three, so typing "private" narrows to private channels and an id
                    // pasted from Slack finds its own row.
                    value={`${option.label} ${option.description ?? ""} ${option.value}`}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <OptionLabel option={option} />
                    {/* A tick as well as the highlight — selection never rides on colour alone. */}
                    <CheckIcon
                      className={cn("ml-auto size-4 shrink-0", option.value === value ? "opacity-100" : "opacity-0")}
                      aria-hidden="true"
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RefreshButton isFetching={query.isFetching} noun={noun} onRefresh={() => void query.refetch()} />
        <p className="text-muted-foreground text-xs">
          {query.data.truncated
            ? `Showing the first ${options.length.toLocaleString()} of more than the builder will list.`
            : `${options.length.toLocaleString()} ${options.length === 1 ? "option" : "options"}.`}
        </p>
      </div>

      {/* A value saved before the list changed — the channel was archived, or the app removed from it. */}
      {isStale && (
        <p role="alert" className="text-node-amber text-xs leading-relaxed">
          The saved value <span className="font-mono">{value}</span> is not in this list any more. Choose another.
        </p>
      )}
    </div>
  );
}

/**
 * An option's name, with its qualifier beside it.
 *
 * The lock is decorative: "private" is written out next to it, so the distinction survives for anyone
 * who cannot make out a 12px glyph.
 */
function OptionLabel({ option }: { option: PropertyOption }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {option.description === "private" && <LockIcon className="size-3 shrink-0 opacity-70" aria-hidden="true" />}
      <span className="truncate" title={option.label}>
        {option.label}
      </span>
      {option.description && <span className="shrink-0 text-muted-foreground text-xs">{option.description}</span>}
    </span>
  );
}

function RefreshButton({ isFetching, noun, onRefresh }: { isFetching: boolean; noun: string; onRefresh: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto px-1.5 py-1 text-xs"
      disabled={isFetching}
      onClick={onRefresh}
    >
      <RotateCcwIcon data-icon="inline-start" className={cn(isFetching && "animate-spin")} />
      {isFetching ? `Refreshing ${noun}…` : "Refresh"}
    </Button>
  );
}

function Notice({
  fieldId,
  describedBy,
  children,
}: {
  fieldId: string;
  describedBy: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <p
      id={fieldId}
      aria-describedby={describedBy}
      className="rounded-md border border-input border-dashed px-3 py-2.5 text-muted-foreground text-xs leading-relaxed"
    >
      {children}
    </p>
  );
}
