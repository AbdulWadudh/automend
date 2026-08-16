/**
 * Finding and freeing whatever is holding a port the dev loop needs.
 *
 * Split out of `dev-up.ts` because it is the one part that terminates someone else's process, and
 * that deserves to be read on its own. Nothing here kills anything without either an explicit
 * confirmation at the terminal or the `--free-ports` flag.
 */

export type PortOwner = {
  port: number;
  pid: number;
  processName: string;
};

async function capture(command: string[]): Promise<string> {
  try {
    const child = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" });
    const stdout = await new Response(child.stdout).text();
    await child.exited;
    return stdout;
  } catch {
    // The tool is missing from PATH. Treated as "nothing found" — the caller then reports the
    // port as free, and the app's own EADDRINUSE remains the backstop.
    return "";
  }
}

/**
 * Windows has no `lsof`. `Get-NetTCPConnection` is the closest equivalent and, unlike parsing
 * `netstat -ano`, it needs no locale-dependent column splitting.
 */
async function findOwnerOnWindows(port: number): Promise<PortOwner | null> {
  const script = `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; "$($c.OwningProcess)|$($p.ProcessName)" }`;
  const output = (await capture(["powershell", "-NoProfile", "-NonInteractive", "-Command", script])).trim();

  if (!output) {
    return null;
  }

  const [pid, processName] = output.split("|");
  const parsedPid = Number(pid);

  return Number.isInteger(parsedPid) ? { port, pid: parsedPid, processName: processName || "unknown" } : null;
}

async function findOwnerOnUnix(port: number): Promise<PortOwner | null> {
  const pids = (await capture(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])).trim();
  const firstPid = Number(pids.split("\n")[0]);

  if (!Number.isInteger(firstPid) || firstPid <= 0) {
    return null;
  }

  const processName = (await capture(["ps", "-p", String(firstPid), "-o", "comm="])).trim();

  return { port, pid: firstPid, processName: processName || "unknown" };
}

export async function findPortOwner(port: number): Promise<PortOwner | null> {
  return process.platform === "win32" ? await findOwnerOnWindows(port) : await findOwnerOnUnix(port);
}

/**
 * Asks for a terminating signal and waits for the port to actually come free.
 *
 * Exit is confirmed by re-probing the port rather than by the kill call returning: a process can
 * take a moment to unwind, and reporting success while the port is still bound only moves the
 * EADDRINUSE a few seconds later.
 */
export async function freePort(owner: PortOwner, attempts = 10, intervalMs = 200): Promise<boolean> {
  try {
    process.kill(owner.pid, "SIGTERM");
  } catch {
    // Already gone, or not ours to signal. The probe below decides which.
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    await Bun.sleep(intervalMs);

    if (!(await findPortOwner(owner.port))) {
      return true;
    }
  }

  return false;
}

export function describeOwner(owner: PortOwner, label: string): string {
  return `port ${owner.port} (${label}) is held by ${owner.processName} pid ${owner.pid}`;
}
