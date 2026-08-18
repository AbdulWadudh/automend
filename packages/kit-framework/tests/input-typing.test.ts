import { describe, expect, test } from "bun:test";
import { createAction } from "../src/action";
import { Property } from "../src/property";
import { createTrigger } from "../src/trigger";
import { createFakeInvocation } from "./support/fake-invocation";

/**
 * A **compile-time** regression test. The assertions that matter here are the type annotations, not the
 * `expect` calls — if `ResolvedInput` stops narrowing, `bun run typecheck` fails and this file is where
 * it points.
 *
 * The bug it guards against is subtle and was live once. A kit declares its properties inline inside the
 * `createAction` spec, so the object literal gets a contextual type of `InputPropertyMap` — and because
 * that type mentions `ShortTextProperty<boolean>`, the contextual type pinned each builder's `Required`
 * to `boolean` before the argument was looked at. `required: true` was silently forgotten, every field
 * became `| undefined`, and each action had to open with guards against a case the resolved schema has
 * already made impossible. `const` on the builders' `Required` parameter is what fixes it, and nothing
 * about the fix is self-evident from reading the call site — hence this.
 */
describe("what a kit author receives in ctx.input", () => {
  test("a required property is not optional, so no action needs a guard for it", async () => {
    const action = createAction({
      name: "probe",
      displayName: "Probe",
      description: "Pins the inference",
      props: {
        text: Property.shortText({ displayName: "Text", required: true }),
        body: Property.longText({ displayName: "Body", required: true }),
        count: Property.number({ displayName: "Count", required: true }),
        flag: Property.checkbox({ displayName: "Flag", required: true }),
        method: Property.staticDropdown({
          displayName: "Method",
          required: true,
          options: [
            { label: "GET", value: "GET" },
            { label: "POST", value: "POST" },
          ],
        }),
      },
      run: async (context) => {
        // Each annotation fails to compile if the literal `required: true` was lost.
        const text: string = context.input.text;
        const body: string = context.input.body;
        const count: number = context.input.count;
        const flag: boolean = context.input.flag;
        // Narrowed to its own options, not widened to `string`.
        const method: "GET" | "POST" = context.input.method;

        return { text, body, count, flag, method };
      },
    });

    const output = await action.invoke(
      createFakeInvocation({
        input: { text: "hello", body: "world", count: 2, flag: true, method: "POST" },
      }),
    );

    expect(output).toEqual({ text: "hello", body: "world", count: 2, flag: true, method: "POST" });
  });

  test("an optional property is undefined-able, so absence has to be handled", async () => {
    const action = createAction({
      name: "probe",
      displayName: "Probe",
      description: "Pins the inference",
      props: { note: Property.shortText({ displayName: "Note" }) },
      run: async (context) => {
        const note: string | undefined = context.input.note;

        return { note: note ?? "(none)" };
      },
    });

    expect(await action.invoke(createFakeInvocation({ input: {} }))).toEqual({ note: "(none)" });
  });

  test("a trigger narrows its input the same way", async () => {
    const trigger = createTrigger({
      name: "probe",
      displayName: "Probe",
      description: "Pins the inference",
      strategy: "webhook",
      props: {
        path: Property.shortText({ displayName: "Path", required: true, templatable: false }),
        query: Property.shortText({ displayName: "Query" }),
      },
      sampleData: {},
      produce: async (context) => {
        const path: string = context.input.path;
        const query: string | undefined = context.input.query;

        return [{ path, query }];
      },
    });

    const produced = await trigger.produce({
      ...createFakeInvocation({ input: { path: "incoming" } }),
      payload: undefined,
    });

    expect(produced).toEqual([{ path: "incoming", query: undefined }]);
  });
});
