import { spawnSync } from "node:child_process";
import { getAncestorPids } from "./process";

export interface TmuxPane {
  session: string;
  windowIndex: number;
  windowName: string;
  paneIndex: number;
  paneId: string;
  paneTitle: string;
  command: string;
  pid: number;
}

export function isTmuxAvailable(): boolean {
  const proc = spawnSync("tmux", ["info"], { encoding: "utf8" });
  return proc.status === 0;
}

export function listTmuxPanes(): TmuxPane[] {
  if (!isTmuxAvailable()) return [];

  const fmt =
    "#{session_name}\t#{window_index}\t#{window_name}\t#{pane_index}\t#{pane_id}\t#{pane_title}\t#{pane_current_command}\t#{pane_pid}";
  const proc = spawnSync("tmux", ["list-panes", "-a", "-F", fmt], {
    encoding: "utf8",
  });
  if (proc.status !== 0) return [];

  return proc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line): TmuxPane | null => {
      const parts = line.split("\t");
      if (parts.length < 8) return null;
      const pid = Number.parseInt(parts[7]!, 10);
      if (!Number.isFinite(pid)) return null;
      return {
        session: parts[0]!,
        windowIndex: Number.parseInt(parts[1]!, 10),
        windowName: parts[2]!,
        paneIndex: Number.parseInt(parts[3]!, 10),
        paneId: parts[4]!,
        paneTitle: parts[5]!,
        command: parts[6]!,
        pid,
      };
    })
    .filter((p): p is TmuxPane => p !== null);
}

export function capturePane(target: string, lines: number = 10): string[] {
  // -S -200: include up to 200 lines of scrollback so we have at least `lines`
  // even when the pane has emitted few visible lines.
  const proc = spawnSync(
    "tmux",
    ["capture-pane", "-t", target, "-p", "-S", "-200"],
    { encoding: "utf8", timeout: 1000 },
  );
  if (proc.status !== 0) return [];

  const all = proc.stdout.split("\n");
  while (all.length > 0 && all[all.length - 1]!.trim() === "") all.pop();
  return all.slice(-lines);
}

export function switchToPane(pane: TmuxPane): { ok: boolean; error?: string } {
  const paneTarget = `${pane.session}:${pane.windowIndex}.${pane.paneIndex}`;
  const winTarget = `${pane.session}:${pane.windowIndex}`;

  spawnSync("tmux", ["select-pane", "-t", paneTarget], { encoding: "utf8" });
  spawnSync("tmux", ["select-window", "-t", winTarget], { encoding: "utf8" });
  const r = spawnSync("tmux", ["switch-client", "-t", pane.session], {
    encoding: "utf8",
  });
  if (r.status === 0) return { ok: true };
  return {
    ok: false,
    error: (r.stderr || r.error?.message || "unknown").toString().trim(),
  };
}

export function findTmuxPaneForPid(
  pid: number,
  panes: TmuxPane[],
): TmuxPane | null {
  if (panes.length === 0) return null;
  const byPid = new Map(panes.map((p) => [p.pid, p]));
  if (byPid.has(pid)) return byPid.get(pid)!;
  for (const ancestor of getAncestorPids(pid)) {
    if (byPid.has(ancestor)) return byPid.get(ancestor)!;
  }
  return null;
}
