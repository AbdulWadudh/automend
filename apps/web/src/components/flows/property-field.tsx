/**
 * One field, rendered from a kit's description of it.
 *
 * This is the component that makes the kit model pay off in the UI. Before it, every step kind had a
 * hand-written panel — adding Slack meant writing a form as well as a kit. Now a kit declares
 * `Property.shortText({ displayName: "To", required: true })` and the form appears.
 *
 * The rules it follows are the ones the project already committed to, and each is here for a reason a reviewer
 * should be able to see:
 *
 * - **A visible label, never a placeholder standing in for one.** A placeholder vanishes exactly when the user
 *   needs it, which is while they are typing into the field it described.
 * - **Helper text under the field, errors next to the field they belong to** — connected with
 *   `aria-describedby` and announced with `role="alert"`, so the error is not visual-only.
 * - **A Radix `Select`, never a native `<select>`.** A native option list is drawn by the operating system in
 *   *its* colours; against this dark theme it comes back light with unreadable items, and no CSS can reach it.
 * - **Colour never carries meaning alone.** An invalid field gets a message, not just a red ring.
 */

import type { KitProperty } from "@automend/kit-framework";
import type { TemplateVariable } from "@automend/shared";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DynamicDropdownField, type OptionsSource } from "./dynamic-dropdown-field";
import { TemplateField } from "./template-field/template-field";

export type PropertyFieldProps = {
  property: KitProperty;
  /** Namespaced so two nodes' fields cannot collide on an element id. */
  idPrefix: string;
  value: unknown;
  /** The variables this flow actually receives, offered inside templatable fields. */
  variables: TemplateVariable[];
  /** Set when the value fails the kit's own schema, so it can be shown against the field. */
  error?: string;
  /** Where a dynamic dropdown fetches its choices. Absent for a property map that has none. */
  optionsSource?: OptionsSource;
  onChange: (value: unknown) => void;
};

/** Text is the shape most values arrive in, so reading one has to be total rather than assumed. */
function asText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  return typeof value === "string" ? value : String(value);
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

/**
 * The hint under a field, assembled from what the kit said and what the field can do.
 *
 * The variable hint is appended rather than left to the kit author, so every templatable field says the same
 * thing in the same words — an author should not have to learn the syntax twice.
 */
function buildHint(property: KitProperty): string | undefined {
  const parts = [property.description, describeRange(property)];

  if (property.templatable) {
    parts.push("Type {{ to insert data the flow received.");
  }

  const hint = parts.filter(Boolean).join(" ");

  return hint.length > 0 ? hint : undefined;
}

/**
 * The accepted range, stated rather than only enforced.
 *
 * A number field cannot clamp as you type, because the value may be `{{retryAfterMs}}` and have no magnitude
 * until the flow runs. So the bound is told to the author up front instead of surfacing as a save failure.
 */
function describeRange(property: KitProperty): string | undefined {
  if (property.type !== "number") {
    return undefined;
  }

  const { minimum, maximum } = property;

  if (minimum !== undefined && maximum !== undefined) {
    return `Between ${minimum.toLocaleString()} and ${maximum.toLocaleString()}.`;
  }

  if (maximum !== undefined) {
    return `Up to ${maximum.toLocaleString()}.`;
  }

  return minimum === undefined ? undefined : `At least ${minimum.toLocaleString()}.`;
}

export function PropertyField({
  property,
  idPrefix,
  value,
  variables,
  error,
  optionsSource,
  onChange,
}: PropertyFieldProps) {
  const fieldId = `${idPrefix}-${property.name}`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const hint = buildHint(property);
  // Both are referenced, so a screen reader gets the explanation *and* the problem rather than one replacing
  // the other.
  const describedBy = [hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>
        {property.displayName}
        {property.required && (
          <>
            {" "}
            <span aria-hidden="true" className="text-muted-foreground">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </Label>

      <PropertyControl
        property={property}
        fieldId={fieldId}
        describedBy={describedBy}
        invalid={error !== undefined}
        value={value}
        variables={variables}
        optionsSource={optionsSource}
        onChange={onChange}
      />

      {hint && (
        <p id={hintId} className="text-muted-foreground text-xs leading-relaxed">
          {hint}
        </p>
      )}

      {/* A message, not only a red border — colour on its own is unreadable to a lot of people. */}
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-xs leading-relaxed">
          {error}
        </p>
      )}
    </div>
  );
}

type ControlProps = {
  property: KitProperty;
  fieldId: string;
  describedBy: string | undefined;
  invalid: boolean;
  value: unknown;
  variables: TemplateVariable[];
  optionsSource: OptionsSource | undefined;
  onChange: (value: unknown) => void;
};

function PropertyControl({
  property,
  fieldId,
  describedBy,
  invalid,
  value,
  variables,
  optionsSource,
  onChange,
}: ControlProps) {
  const shared = {
    id: fieldId,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
  };

  switch (property.type) {
    case "shortText":
      return (
        <TemplateField
          {...shared}
          value={asText(value)}
          variables={variables}
          maxLength={property.maxLength}
          onChange={onChange}
        />
      );

    case "longText":
      return (
        <TemplateField
          {...shared}
          value={asText(value)}
          variables={variables}
          maxLength={property.maxLength}
          multiline
          rich={property.rich ?? false}
          onChange={onChange}
        />
      );

    /**
     * A number field is a *text* field, because the value may be `{{orderCount}}` rather than a number. Using
     * `type="number"` would let the browser refuse the very syntax that makes a flow useful — and the engine
     * coerces the resolved value anyway, so nothing is lost by accepting text here.
     *
     * `tabular-nums` so a column of digits does not shift width as it is typed.
     */
    case "number":
      return (
        <TemplateField
          {...shared}
          value={asText(value)}
          variables={variables}
          className="tabular-nums"
          onChange={onChange}
        />
      );

    case "checkbox":
      return (
        <label htmlFor={fieldId} className="flex cursor-pointer items-center gap-2.5 py-1 text-sm">
          <input
            {...shared}
            type="checkbox"
            checked={asBoolean(value)}
            className="size-4 shrink-0 cursor-pointer rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            onChange={(event) => onChange(event.target.checked)}
          />
          <span className="text-muted-foreground">{property.displayName}</span>
        </label>
      );

    /**
     * Radix, never a native `<select>`. The browser draws a native option list in the operating system's
     * colours, so on this dark theme it returns light with unreadable items and no CSS can reach it.
     */
    case "staticDropdown":
      return (
        <Select value={asText(value)} onValueChange={onChange}>
          <SelectTrigger id={fieldId} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            {(property.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    /**
     * Fetched from the service rather than declared, so it needs the step's connection to ask with.
     * Without a source there is nothing to fetch through, which is a build mismatch rather than a
     * state an author can be in — so it falls through to the same notice an unknown type gets.
     */
    case "dynamicDropdown":
      if (optionsSource) {
        return (
          <DynamicDropdownField
            property={property}
            source={optionsSource}
            fieldId={fieldId}
            describedBy={describedBy}
            invalid={invalid}
            value={asText(value)}
            onChange={onChange}
          />
        );
      }

      break;

    case "json":
      return (
        <TemplateField
          {...shared}
          value={asText(value)}
          variables={variables}
          multiline
          className="font-mono text-xs"
          onChange={onChange}
        />
      );

    /**
     * A property type the API knows about and this build does not.
     *
     * Reachable only when the web app is older than the API — a deploy in progress. Saying so beats rendering
     * nothing, which would look like a kit with a missing field and lose the value silently on the next save.
     */
    default:
      break;
  }

  return (
    <p className="rounded-lg bg-node-amber/10 px-3 py-2.5 text-node-amber text-xs leading-relaxed">
      This field needs a newer version of the builder than the one you are running. Reload the page; if it persists, the
      web app and the API are on different versions.
    </p>
  );
}

/**
 * A whole property map, in the order the kit declared it.
 *
 * Order matters and is not alphabetical: a kit lists recipient before subject before body because that is the
 * order somebody fills them in, and the catalogue preserves it as an array for exactly this reason.
 */
export function PropertyFields({
  properties,
  idPrefix,
  input,
  variables,
  errors,
  optionsSource,
  onChange,
}: {
  properties: readonly KitProperty[];
  idPrefix: string;
  input: Record<string, unknown>;
  variables: TemplateVariable[];
  errors?: Readonly<Record<string, string>>;
  optionsSource?: OptionsSource;
  onChange: (name: string, value: unknown) => void;
}) {
  if (properties.length === 0) {
    return (
      <p className="text-muted-foreground text-xs leading-relaxed">
        Nothing to configure — this one works as soon as it is connected.
      </p>
    );
  }

  return (
    <>
      {properties.map((property) => (
        <PropertyField
          key={property.name}
          property={property}
          idPrefix={idPrefix}
          value={input[property.name] ?? property.defaultValue}
          variables={variables}
          error={errors?.[property.name]}
          optionsSource={optionsSource}
          onChange={(value) => onChange(property.name, value)}
        />
      ))}
    </>
  );
}
