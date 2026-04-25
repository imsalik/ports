import { spawnSync } from "node:child_process";

export interface PortEntry {
  port: number;
  protocol: "tcp" | "tcp6" | "tcp46";
  address: string;
  pid: number | null;
  command: string | null;
}

function parseSsLine(line: string): PortEntry | null {
  const cols = line.trim().split(/\s+/);
  if (cols.length < 4) return null;

  const localAddr = cols[3];
  if (!localAddr) return null;
  const processCol = cols.slice(5).join(" ");

  const isV6 = localAddr.startsWith("[");
  const portMatch = localAddr.match(/:(\d+)$/);
  if (!portMatch) return null;

  const port = Number.parseInt(portMatch[1]!, 10);
  const address = localAddr.substring(0, localAddr.lastIndexOf(":"));

  let pid: number | null = null;
  let command: string | null = null;
  const pidMatch = processCol.match(/pid=(\d+)/);
  const nameMatch = processCol.match(/\("([^"]+)"/);
  if (pidMatch) pid = Number.parseInt(pidMatch[1]!, 10);
  if (nameMatch) command = nameMatch[1]!;

  return {
    port,
    protocol: isV6 ? "tcp6" : "tcp",
    address,
    pid,
    command,
  };
}

export function listListeningPorts(): PortEntry[] {
  const proc = spawnSync("ss", ["-tlnpH"], { encoding: "utf8" });
  if (proc.status !== 0) return [];

  const map = new Map<string, PortEntry>();
  for (const line of proc.stdout.split("\n")) {
    if (!line.trim()) continue;
    const entry = parseSsLine(line);
    if (!entry) continue;

    const key = `${entry.port}::${entry.pid ?? "?"}::${entry.command ?? "?"}`;
    const existing = map.get(key);
    if (existing) {
      if (existing.protocol !== entry.protocol) existing.protocol = "tcp46";
    } else {
      map.set(key, entry);
    }
  }

  const entries = [...map.values()];
  entries.sort((a, b) => a.port - b.port || (a.pid ?? 0) - (b.pid ?? 0));
  return entries;
}

export function killProcess(
  pid: number,
  signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
): { ok: boolean; error?: string } {
  try {
    process.kill(pid, signal);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
