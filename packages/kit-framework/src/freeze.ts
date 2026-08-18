/**
 * Deep-freezes the assembled kit registry, once, at process start.
 *
 * Kit definitions are module-level singletons: one `gmail` object serves every run the worker handles
 * for as long as the process lives. A stray mutation to a property's options or to a kit's action list
 * would therefore not fail near the bug — it would quietly change how every later run behaves, in a
 * process that may stay up for weeks.
 *
 * The `readonly` types say this already, but the registry and the engine pass actions around with
 * their generics erased, so there are paths the compiler is not watching. This closes them at run
 * time.
 *
 * Applied at the registry rather than in each factory on purpose: `Object.freeze` is shallow, so
 * freezing a kit still leaves its `actions` array and its properties' `options` arrays mutable.
 * Freezing the finished tree in one place is the only version of this that is actually true.
 */
export function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  // Frozen before descending, so a cycle cannot send this into infinite recursion.
  Object.freeze(value);

  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }

  return value;
}
