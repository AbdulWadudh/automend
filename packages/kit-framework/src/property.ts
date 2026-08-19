/**
 * The inputs a kit declares, and the values they resolve to.
 *
 * A property is a *description* of a field, not a field: the builder renders a control from it, the
 * framework derives two Zod schemas from it (see `input-schema.ts`), and the engine hands the kit a
 * value typed from it. Declaring a property is therefore the whole of what a kit author does to gain
 * a form, validation and a typed `ctx.input` — which is what makes adding a service cheap.
 *
 * The type list lives in `config.kits.propertyTypes`, because every entry needs a branch in the
 * schema builder and a control in the inspector. It is short deliberately.
 */

import { config } from "@automend/shared";
import type { KitCredential } from "./credential";
import type { HttpClient, KitLogger } from "./http";

export type PropertyType = (typeof config.kits.propertyTypes)[number];

/**
 * Whether `{{variable}}` substitution runs on a property's value, by type.
 *
 * A toggle has nowhere to type a variable into, and a dropdown's value has to stay one of its
 * options — both would need a different control before a template could reach them. Everything else
 * is text in the builder, including `number`: a field holding `{{orderCount}}` is a string at rest
 * and a number only once the flow has data.
 *
 * This is the default, not the rule. A property may opt out — see `templatable` on `PropertySpec`.
 */
const TEMPLATABLE_BY_TYPE: Readonly<Record<PropertyType, boolean>> = {
  shortText: true,
  longText: true,
  number: true,
  json: true,
  checkbox: false,
  staticDropdown: false,
  // Its value has to be one of the options the service returned, which a template cannot promise.
  dynamicDropdown: false,
};

/**
 * How much text each kind of field may hold, when the kit does not say.
 *
 * The point is that *unbounded* is not what an author gets by forgetting: a flow definition is one
 * `jsonb` document written whole, so one unbounded field is a way to produce a row nobody can load.
 * A checkbox and a dropdown are not text at rest and so have no bound to apply.
 */
const MAX_LENGTH_BY_TYPE: Readonly<Record<PropertyType, number | undefined>> = {
  shortText: config.kits.textMaxLength.short,
  // A number's stored form is the text of a template, which is never long.
  number: config.kits.textMaxLength.short,
  longText: config.kits.textMaxLength.long,
  json: config.kits.textMaxLength.long,
  checkbox: undefined,
  staticDropdown: undefined,
  // Unlike a static dropdown's, this value cannot be checked against a list nobody has fetched, so
  // the one thing that can be bounded at rest is its length.
  dynamicDropdown: config.kits.textMaxLength.short,
};

type PropertyShape<Type extends PropertyType, Required extends boolean, Value> = {
  readonly type: Type;
  readonly displayName: string;
  /** Shown under the field. A placeholder is not a label, and neither is this. */
  readonly description?: string;
  readonly required: Required;
  readonly templatable: boolean;
  readonly defaultValue?: Value;
  /**
   * Bounds the text an author may store in this field. Undefined for the two types that are not text
   * at rest.
   *
   * Deliberately *not* re-checked once a variable has resolved: a short template may legitimately
   * substitute a large value, and truncating that would corrupt the data rather than protect anything.
   * The mirror image of a number's `minimum`/`maximum`, which can only be checked after resolution.
   */
  readonly maxLength?: number;
};

export type ShortTextProperty<Required extends boolean = boolean> = PropertyShape<"shortText", Required, string>;
/**
 * Several lines of text.
 *
 * `rich` decides whether the builder offers formatting, and it is not cosmetic: a rich field stores
 * *HTML*. That suits an email body and ruins everything else — a JSON request body, a log line, or
 * Slack's mrkdwn would each be sent with `<p>` wrapped round it. So it is opt-in, and a kit that
 * wants formatting says so.
 */
export type LongTextProperty<Required extends boolean = boolean> = PropertyShape<"longText", Required, string> & {
  readonly rich: boolean;
};
export type NumberProperty<Required extends boolean = boolean> = PropertyShape<"number", Required, number> & {
  /**
   * Checked when the value is resolved, not when it is stored — a field holding `{{delayMs}}` is text
   * and cannot be range-checked until the flow has data to substitute.
   */
  readonly minimum?: number;
  readonly maximum?: number;
};
export type CheckboxProperty<Required extends boolean = boolean> = PropertyShape<"checkbox", Required, boolean>;
/**
 * `never` for the default, so declaring one is a type error.
 *
 * A default is expressed in resolved space — a `number` property defaults to `5`, not to `"5"` — but
 * a JSON field's resolved value comes out of parsing its text, and there is no sound way to feed an
 * already-parsed default back through that. A JSON field starts empty.
 */
export type JsonProperty<Required extends boolean = boolean> = PropertyShape<"json", Required, never>;

export type DropdownOption<Value extends string> = {
  readonly label: string;
  readonly value: Value;
  /**
   * A qualifier shown beside the label — "private", "archived", the sheet's owner.
   *
   * Separate from the label rather than folded into it so the builder can style it as secondary and
   * still search it, and so an option is never distinguished by an icon or a colour alone.
   */
  readonly description?: string;
};

export type StaticDropdownProperty<Value extends string = string, Required extends boolean = boolean> = PropertyShape<
  "staticDropdown",
  Required,
  Value
> & {
  readonly options: readonly DropdownOption<Value>[];
};

/**
 * What an option loader is given.
 *
 * Deliberately narrower than a step's context: there is no run, no store and no idempotency key,
 * because listing what a service holds is not part of any run. It gets the same guarded HTTP client
 * and the same one credential, and it runs in the same subprocess — the rule about where kit code
 * executes does not soften because the caller is a builder rather than an engine.
 */
export type LoadOptionsContext = {
  readonly auth: KitCredential | undefined;
  readonly http: HttpClient;
  readonly logger: KitLogger;
  /** What the author has configured on this step so far, for a dropdown that narrows another. */
  readonly input: Record<string, unknown>;
};

export type LoadOptions = (context: LoadOptionsContext) => Promise<readonly DropdownOption<string>[]>;

/**
 * Choices fetched from the service — a Slack channel, a spreadsheet tab.
 *
 * The value narrows no further than `string`: what the options are is not known when the kit is
 * written, so neither the stored schema nor the resolved one can check membership. That is honest
 * rather than lax — the alternative is a check that pretends to know a list it has never seen.
 */
export type DynamicDropdownProperty<Required extends boolean = boolean> = PropertyShape<
  "dynamicDropdown",
  Required,
  string
> & {
  readonly loadOptions: LoadOptions;
  /**
   * Properties whose values the loader reads. The builder refetches when one of them changes, and
   * offers nothing until every one of them has a value.
   */
  readonly dependsOn: readonly string[];
};

export type InputProperty =
  | ShortTextProperty
  | LongTextProperty
  | NumberProperty
  | CheckboxProperty
  | JsonProperty
  | StaticDropdownProperty
  | DynamicDropdownProperty;

/** What an action or trigger declares: a name for each field, and the field's description. */
export type InputPropertyMap = Readonly<Record<string, InputProperty>>;

/**
 * The type a property's value has once the engine has resolved templates and coerced it.
 *
 * A static dropdown narrows to the union of its own option values, so a kit reading
 * `ctx.input.method` gets `"GET" | "POST"` rather than `string`.
 */
export type PropertyValue<Property extends InputProperty> =
  Property extends StaticDropdownProperty<infer Value, boolean>
    ? Value
    : Property extends { readonly type: "shortText" | "longText" | "dynamicDropdown" }
      ? string
      : Property extends { readonly type: "number" }
        ? number
        : Property extends { readonly type: "checkbox" }
          ? boolean
          : unknown;

/**
 * `ctx.input` for a given property map.
 *
 * An optional property is `| undefined` rather than an optional key, so a kit has to acknowledge the
 * absent case instead of it disappearing behind a missing property.
 */
export type ResolvedInput<Props extends InputPropertyMap> = {
  readonly [Key in keyof Props]: Props[Key]["required"] extends true
    ? PropertyValue<Props[Key]>
    : PropertyValue<Props[Key]> | undefined;
};

type PropertySpec<Value, Required extends boolean> = {
  displayName: string;
  description?: string;
  required?: Required;
  defaultValue?: Value;
  /**
   * Opts a property out of `{{variable}}` substitution against its type's default.
   *
   * For structural fields rather than data ones: a webhook's path is a route and a cron expression is
   * a schedule, and both are read before a flow has any data to substitute — so offering a variable
   * picker on them would advertise something that could never resolve.
   */
  templatable?: boolean;
  /** Raises or lowers the per-type default. */
  maxLength?: number;
};

function build<Type extends PropertyType, Required extends boolean, Value>(
  type: Type,
  spec: PropertySpec<Value, Required>,
): PropertyShape<Type, Required, Value> {
  return {
    type,
    displayName: spec.displayName,
    description: spec.description,
    // `?? false` widens to `boolean`, which loses the literal the caller passed and with it the
    // `required extends true` test in `ResolvedInput`. The default is the same value either way.
    required: (spec.required ?? false) as Required,
    templatable: spec.templatable ?? TEMPLATABLE_BY_TYPE[type],
    maxLength: spec.maxLength ?? MAX_LENGTH_BY_TYPE[type],
    defaultValue: spec.defaultValue,
  };
}

/**
 * The property constructors a kit author uses.
 *
 * An object of functions rather than a class, and each returns a plain object — a property is data the
 * framework reads, never something with behaviour of its own. The registry deep-freezes the finished
 * tree at start-up (see `freeze.ts`), so nothing here needs to defend itself.
 *
 * `Required` is a `const` type parameter on every one of them, and that is load-bearing rather than
 * decorative. A kit declares its properties *inline* inside the `createAction` spec, which gives the
 * object literal a contextual type of `InputPropertyMap` — and because that mentions
 * `ShortTextProperty<boolean>`, the contextual type would otherwise pin `Required` to `boolean` before
 * the argument is even looked at. `required: true` would then be forgotten, `ResolvedInput` would make
 * every field `| undefined`, and each action would open with guards the resolved schema has already
 * made impossible to fail. `const` makes the argument win.
 */
export const Property = {
  /** A single line of text. */
  shortText<const Required extends boolean = false>(spec: PropertySpec<string, Required>): ShortTextProperty<Required> {
    return build("shortText", spec);
  },

  /** Several lines — an email body, a message, a note. */
  longText<const Required extends boolean = false>(
    spec: PropertySpec<string, Required> & { rich?: boolean },
  ): LongTextProperty<Required> {
    return { ...build("longText", spec), rich: spec.rich ?? false };
  },

  number<const Required extends boolean = false>(
    spec: PropertySpec<number, Required> & { minimum?: number; maximum?: number },
  ): NumberProperty<Required> {
    return { ...build("number", spec), minimum: spec.minimum, maximum: spec.maximum };
  },

  checkbox<const Required extends boolean = false>(spec: PropertySpec<boolean, Required>): CheckboxProperty<Required> {
    return build("checkbox", spec);
  },

  /** Free-form structured data. Validated as parseable JSON, not against a shape. */
  json<const Required extends boolean = false>(
    spec: Omit<PropertySpec<never, Required>, "defaultValue">,
  ): JsonProperty<Required> {
    return build("json", spec);
  },

  /** A fixed set of choices, known when the kit is written. */
  staticDropdown<const Value extends string, const Required extends boolean = false>(
    spec: PropertySpec<Value, Required> & { options: readonly DropdownOption<Value>[] },
  ): StaticDropdownProperty<Value, Required> {
    return {
      ...build("staticDropdown", spec),
      options: spec.options,
    };
  },

  /**
   * Choices fetched from the service the connection points at.
   *
   * `loadOptions` is kit code and runs where all kit code runs — the subprocess, with the step's
   * credential and the guarded client, never in the api that asked for it.
   */
  dynamicDropdown<const Required extends boolean = false>(
    spec: PropertySpec<string, Required> & { loadOptions: LoadOptions; dependsOn?: readonly string[] },
  ): DynamicDropdownProperty<Required> {
    return {
      ...build("dynamicDropdown", spec),
      loadOptions: spec.loadOptions,
      dependsOn: spec.dependsOn ?? [],
    };
  },
} as const;
