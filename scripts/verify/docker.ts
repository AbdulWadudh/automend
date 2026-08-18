/**
 * Running commands for the verify gates.
 *
 * Every command is spawned with an argv array rather than through a shell: on Windows the Git Bash
 * layer rewrites anything that looks like a POSIX path, so `/app/packages/db` reaches the container
 * as `C:/Program Files/Git/app/packages/db` and the run fails for a reason that has nothing to do
 * with the code under test.
 */

export type CommandResult = {
  ok: boolean;
  output: string;
};

export async function run(command: string[], options?: { env?: Record<string, string> }): Promise<CommandResult> {
  const child = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    env: options?.env ? { ...process.env, ...options.env } : process.env,
  });

  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const exitCode = await child.exited;

  return { ok: exitCode === 0, output: `${stdout}${stderr}`.trim() };
}

export async function isDockerRunning(): Promise<boolean> {
  const { ok } = await run(["docker", "version", "--format", "{{.Server.Version}}"]);
  return ok;
}

/**
 * Waits for a Postgres container to accept a real query.
 *
 * `pg_isready` alone is not enough: the official image starts a temporary server to run its
 * initialisation scripts, and that server answers `pg_isready` before shutting down again. A
 * connection made in that window succeeds and then dies mid-migration.
 */
export async function waitForPostgres(
  container: string,
  user: string,
  database: string,
  attempts: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { ok } = await run(["docker", "exec", container, "psql", "-U", user, "-d", database, "-tAc", "select 1"]);

    if (ok) {
      return true;
    }

    await Bun.sleep(1_000);
  }

  return false;
}
