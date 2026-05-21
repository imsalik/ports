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

function listListeningPortsLinux(): PortEntry[] {
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

function listListeningPortsDarwin(): PortEntry[] {
  // -n: no DNS, -P: numeric ports, -FpcPnT: tagged-line output (pid, cmd, proto, name, tcp-info)
  const proc = spawnSync(
    "lsof",
    ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpcPnT"],
    { encoding: "utf8" },
  );
  // lsof exits 1 when some pids are inaccessible but still emits useful data
  if (proc.status !== 0 && proc.status !== 1) return [];

  const map = new Map<string, PortEntry>();
  let pid: number | null = null;
  let cmd: string | null = null;
  let name: string | null = null;

  const flush = () => {
    if (pid === null || !name) return;
    const isV6 = name.startsWith("[");
    const lastColon = name.lastIndexOf(":");
    if (lastColon < 0) return;
    const port = Number.parseInt(name.substring(lastColon + 1), 10);
    if (!Number.isFinite(port)) return;
    let address = name.substring(0, lastColon);
    if (address === "*") address = isV6 ? "[::]" : "0.0.0.0";

    const entry: PortEntry = {
      port,
      protocol: isV6 ? "tcp6" : "tcp",
      address,
      pid,
      command: cmd,
    };
    const key = `${port}::${pid}::${cmd ?? "?"}`;
    const existing = map.get(key);
    if (existing) {
      if (existing.protocol !== entry.protocol) existing.protocol = "tcp46";
    } else {
      map.set(key, entry);
    }
  };

  for (const line of proc.stdout.split("\n")) {
    if (!line) continue;
    const tag = line[0];
    const val = line.substring(1);
    switch (tag) {
      case "p":
        flush();
        pid = Number.parseInt(val, 10);
        cmd = null;
        name = null;
        break;
      case "c":
        cmd = val;
        break;
      case "f":
        flush();
        name = null;
        break;
      case "n":
        name = val;
        break;
      // "P" (protocol) and "T" (TCP info) lines ignored — we already filtered LISTEN TCP
    }
  }
  flush();

  const entries = [...map.values()];
  entries.sort((a, b) => a.port - b.port || (a.pid ?? 0) - (b.pid ?? 0));
  return entries;
}

export function listListeningPorts(): PortEntry[] {
  return process.platform === "darwin"
    ? listListeningPortsDarwin()
    : listListeningPortsLinux();
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
