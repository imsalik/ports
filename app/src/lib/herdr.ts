import { spawnSync } from "node:child_process";

// Herdr counterpart to lib/tmux.ts. When ports runs inside a Herdr-managed
// pane (HERDR_ENV=1), we resolve a port's owning pane through the `herdr` CLI
// instead of tmux: `pane list` for topology, `pane process-info` for each
// pane's shell pid, `pane read` for a tail, and `tab focus` to jump.

export interface HerdrPane {
  paneId: string;
  tabId: string;
  workspaceId: string;
  workspaceLabel: string;
  tabLabel: string;
  title: string;
  cwd: string;
  agent: string | null;
  pid: number; // the pane's shell pid
}

export function isHerdrAvailable(): boolean {
  return process.env.HERDR_ENV === "1";
}

// Strip control chars (Herdr labels can carry raw escape bytes).
function clean(s: string): string {
  return (s ?? "").replace(/[\u0000-\u001f]/g, "").trim();
}

// Run a herdr CLI command and return its parsed `.result`, or null on any
// failure. Herdr control commands answer with JSON on stdout.
function herdr(args: string[]): any | null {
  const proc = spawnSync("herdr", args, { encoding: "utf8", timeout: 2000 });
  if (proc.status !== 0 || !proc.stdout) return null;
  try {
    return JSON.parse(proc.stdout)?.result ?? null;
  } catch {
    return null;
  }
}

function shellPidForPane(paneId: string): number | null {
  const r = herdr(["pane", "process-info", "--pane", paneId]);
  const pid = r?.process_info?.shell_pid;
  return Number.isFinite(pid) ? pid : null;
}

export function listHerdrPanes(): HerdrPane[] {
  if (!isHerdrAvailable()) return [];

  const paneList = herdr(["pane", "list"]);
  const panes: any[] = paneList?.panes ?? [];
  if (panes.length === 0) return [];

  // workspace_id -> label
  const wsLabels = new Map<string, string>();
  for (const w of herdr(["workspace", "list"])?.workspaces ?? []) {
    wsLabels.set(w.workspace_id, clean(w.label));
  }

  // tab_id -> label, fetched once per distinct workspace.
  const tabLabels = new Map<string, string>();
  for (const wsId of new Set(panes.map((p) => p.workspace_id))) {
    for (const t of herdr(["tab", "list", "--workspace", wsId])?.tabs ?? []) {
      tabLabels.set(t.tab_id, clean(t.label));
    }
  }

  const out: HerdrPane[] = [];
  for (const p of panes) {
    const pid = shellPidForPane(p.pane_id);
    if (pid === null) continue;
    out.push({
      paneId: p.pane_id,
      tabId: p.tab_id,
      workspaceId: p.workspace_id,
      workspaceLabel: wsLabels.get(p.workspace_id) ?? p.workspace_id,
      tabLabel: tabLabels.get(p.tab_id) ?? p.tab_id,
      title: clean(p.terminal_title_stripped ?? p.terminal_title ?? ""),
      cwd: p.foreground_cwd ?? p.cwd ?? "",
      agent: p.agent ?? null,
      pid,
    });
  }
  return out;
}

export function capturePane(paneId: string, lines: number = 10): string[] {
  // `pane read` prints plain text. recent-unwrapped is best for logs; fall back
  // to the visible viewport when the recent buffer is empty (fresh/alt-screen).
  const read = (source: string): string[] => {
    const proc = spawnSync(
      "herdr",
      ["pane", "read", paneId, "--source", source, "--lines", String(lines)],
      { encoding: "utf8", timeout: 1500 },
    );
    if (proc.status !== 0) return [];
    const all = proc.stdout.split("\n");
    while (all.length > 0 && all[all.length - 1]!.trim() === "") all.pop();
    return all.slice(-lines);
  };
  const recent = read("recent-unwrapped");
  return recent.length > 0 ? recent : read("visible");
}

export function focusPane(pane: HerdrPane): { ok: boolean; error?: string } {
  const r = spawnSync("herdr", ["tab", "focus", pane.tabId], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (r.status === 0) return { ok: true };
  return {
    ok: false,
    error: (r.stderr || r.error?.message || "focus failed").toString().trim(),
  };
}
