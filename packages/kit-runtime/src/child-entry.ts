/**
 * Where the child's entry file is on disk, resolved by the package that owns it.
 *
 * A caller cannot compute this from its own location once the child lives in a package rather than
 * beside the code that spawns it, and hard-coding a relative path from each app would break the
 * moment one of them moved.
 *
 * `Bun.fileURLToPath` rather than `.pathname`: on Windows a file URL's pathname is `/G:/…`, with a
 * leading slash that is not part of any real path — bun then fails to find the entry, the child never
 * starts, and the parent waits out its timeout with nothing on stdout to say why.
 */
export const CHILD_ENTRY = Bun.fileURLToPath(new URL("./child.ts", import.meta.url));
