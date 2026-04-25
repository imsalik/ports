import { spawnSync } from "node:child_process";

export interface DockerPortMapping {
  hostIp: string;
  hostPort: number;
  containerPort: number;
  protocol: string;
}

export interface DockerContainer {
  containerId: string;
  shortId: string;
  name: string;
  image: string;
  state: string;
  status: string;
  composeProject?: string;
  composeService?: string;
  ports: DockerPortMapping[];
}

export interface DockerPortHit {
  container: DockerContainer;
  mapping: DockerPortMapping;
}

interface DockerPsRow {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Status: string;
  Ports: string;
  Labels: string;
}

function parsePorts(s: string): DockerPortMapping[] {
  const out: DockerPortMapping[] = [];
  for (const raw of s.split(",")) {
    const p = raw.trim();
    if (!p) continue;
    const m = p.match(/^([^[][^:]*|\[[^\]]+\]):(\d+)->(\d+)\/(\w+)$/);
    if (!m) continue;
    let hostIp = m[1]!;
    if (hostIp.startsWith("[") && hostIp.endsWith("]")) {
      hostIp = hostIp.slice(1, -1);
    }
    out.push({
      hostIp,
      hostPort: Number.parseInt(m[2]!, 10),
      containerPort: Number.parseInt(m[3]!, 10),
      protocol: m[4]!,
    });
  }
  return out;
}

function parseLabels(s: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of s.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    m.set(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
  }
  return m;
}

export function listDockerContainers(): DockerContainer[] {
  const proc = spawnSync(
    "docker",
    ["ps", "--no-trunc", "--format", "{{json .}}"],
    { encoding: "utf8", timeout: 3000 },
  );
  if (proc.error || proc.status !== 0) return [];

  const containers: DockerContainer[] = [];
  for (const line of proc.stdout.split("\n")) {
    if (!line.trim()) continue;
    let row: DockerPsRow;
    try {
      row = JSON.parse(line) as DockerPsRow;
    } catch {
      continue;
    }
    const labels = parseLabels(row.Labels ?? "");
    containers.push({
      containerId: row.ID,
      shortId: row.ID.substring(0, 12),
      name: row.Names,
      image: row.Image,
      state: row.State,
      status: row.Status,
      composeProject: labels.get("com.docker.compose.project"),
      composeService: labels.get("com.docker.compose.service"),
      ports: parsePorts(row.Ports ?? ""),
    });
  }
  return containers;
}

export function getContainerLogs(
  containerId: string,
  lines: number = 10,
): string[] {
  const proc = spawnSync(
    "docker",
    ["logs", "--tail", String(lines), containerId],
    { encoding: "utf8", timeout: 3000 },
  );
  if (proc.error) return [];
  const merged = (proc.stdout ?? "") + (proc.stderr ?? "");
  const all = merged.split("\n");
  while (all.length > 0 && all[all.length - 1]!.trim() === "") all.pop();
  return all.slice(-lines);
}

export function stopDockerContainer(
  containerId: string,
  mode: "stop" | "kill" = "stop",
): { ok: boolean; error?: string } {
  const proc = spawnSync("docker", [mode, containerId], {
    encoding: "utf8",
    timeout: 15000,
  });
  if (proc.status === 0) return { ok: true };
  return {
    ok: false,
    error: (proc.stderr || proc.error?.message || "unknown").toString().trim(),
  };
}

export function buildDockerPortIndex(
  containers: DockerContainer[],
): Map<number, DockerPortHit> {
  const idx = new Map<number, DockerPortHit>();
  for (const c of containers) {
    for (const p of c.ports) {
      if (!idx.has(p.hostPort)) {
        idx.set(p.hostPort, { container: c, mapping: p });
      }
    }
  }
  return idx;
}
