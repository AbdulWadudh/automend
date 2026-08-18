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

import type { config } from "@automend/shared";

export type PropertyType = (typeof config.kits.propertyTypes)[number];

/**
 * Whether `{{variable}}` substitution runs on a property's value, decided by type rather than by the
 * kit author.
 *
 * A toggle has nowhere to type a variable into, and a dropdown's value has to stay one of its
 * options — both would need a different control before a template could reach them. Everything else
 * is text in the builder, including `number`: a field holding `{{orderCount}}` is a string at rest
 * and a number only once the flow has data.
 */
const TEMPLATABLE_BY_TYPE: Readonly<Record<PropertyType, boolean>> = {
  shortText: true,
  longText: true,
  number: true,
  json: true,
  checkbox: false,
  staticDropdown: false,
};

type PropertyShape<Type extends PropertyType, Required extends boolean, Value> = {
  readonly type: Type;
  readonly displayName: string;
  /** Shown under the field. A placeholder is not a label, and neither is this. */
  readonly description?: string;
  readonly required: Required;
  readonly templatable: boolean;
  readonly defaultValue?: Value;
};

export type ShortTextProperty<Required extends boolean = boolean> = PropertyShape<"shortText", Required, string>;
export type LongTextProperty<Required extends boolean = boolean> = PropertyShape<"longText", Required, string>;
export type NumberProperty<Required extends boolean = boolean> = PropertyShape<"number", Required, number>;
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
};

export type StaticDropdownProperty<Value extends string = string, Required extends boolean = boolean> = PropertyShape<
  "staticDropdown",
  Required,
  Value
> & {
  readonly options: readonly DropdownOption<Value>[];
};

export type InputProperty =
  | ShortTextProperty
  | LongTextProperty
  | NumberProperty
  | CheckboxProperty
  | JsonProperty
  | StaticDropdownProperty;

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
    : Property extends { readonly type: "shortText" | "longText" }
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
    templatable: TEMPLATABLE_BY_TYPE[type],
    defaultValue: spec.defaultValue,
  };
}

/**
 * The property constructors a kit author uses.
 *
 * An object of functions rather than a class, and each returns a plain object — a property is data the
 * framework reads, never something with behaviour of its own. The registry deep-freezes the finished
 * tree at start-up (see `freeze.ts`), so nothing here needs to defend itself.
 */
export const Property = {
  /** A single line of text. */
  shortText<Required extends boolean = false>(spec: PropertySpec<string, Required>): ShortTextProperty<Required> {
    return build("shortText", spec);
  },

  /** Several lines — an email body, a message, a note. */
  longText<Required extends boolean = false>(spec: PropertySpec<string, Required>): LongTextProperty<Required> {
    return build("longText", spec);
  },

  number<Required extends boolean = false>(spec: PropertySpec<number, Required>): NumberProperty<Required> {
    return build("number", spec);
  },

  checkbox<Required extends boolean = false>(spec: PropertySpec<boolean, Required>): CheckboxProperty<Required> {
    return build("checkbox", spec);
  },

  /** Free-form structured data. Validated as parseable JSON, not against a shape. */
  json<Required extends boolean = false>(
    spec: Omit<PropertySpec<never, Required>, "defaultValue">,
  ): JsonProperty<Required> {
    return build("json", spec);
  },

  /**
   * A fixed set of choices, known when the kit is written.
   *
   * Choices that have to be fetched from the service — a Slack channel, a spreadsheet tab — are a
   * dynamic dropdown, which does not exist yet.
   */
  staticDropdown<const Value extends string, Required extends boolean = false>(
    spec: PropertySpec<Value, Required> & { options: readonly DropdownOption<Value>[] },
  ): StaticDropdownProperty<Value, Required> {
    return {
      ...build("staticDropdown", spec),
      options: spec.options,
    };
  },
} as const;
