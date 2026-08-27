import { getAncestorPids } from "./process";
import * as tmux from "./tmux";
import * as herdr from "./herdr";

// A single façade over the two pane hosts (tmux and herdr). The UI talks only to
// PaneEntry / PaneHost and never knows which backend resolved the pane. The host
// is picked once at startup: herdr when we're inside a Herdr pane, tmux
// otherwise (tmux.listTmuxPanes already no-ops when tmux isn't running).

export interface DetailRow {
  label: string;
  value: string;
  accent?: "accent" | "light";
}

export interface PaneEntry {
  kind: "tmux" | "herdr";
  pid: number; // the pane's shell pid — used to match a port's owning pane
  rows: DetailRow[]; // detail-panel rows for this pane
  gotoValue: string; // the "Target" row value, incl. the ↵ go hint
  captureTarget: string; // opaque handle passed back to the host for capture
  raw: tmux.TmuxPane | herdr.HerdrPane;
}

export interface PaneHost {
  kind: "tmux" | "herdr";
  header: string; // section title in the details panel
  list(): PaneEntry[];
  capture(entry: PaneEntry, lines: number): string[];
  goto(entry: PaneEntry): { ok: boolean; error?: string };
}

// Match a port's PID to a pane: the shell pid directly, else the nearest
// ancestor that is a pane's shell. Identical logic for both backends.
export function findPaneForPid(
  pid: number,
  entries: PaneEntry[],
): PaneEntry | null {
  if (entries.length === 0) return null;
  const byPid = new Map(entries.map((e) => [e.pid, e]));
  if (byPid.has(pid)) return byPid.get(pid)!;
  for (const ancestor of getAncestorPids(pid)) {
    if (byPid.has(ancestor)) return byPid.get(ancestor)!;
  }
  return null;
}

function tmuxEntry(p: tmux.TmuxPane): PaneEntry {
  const target = `${p.session}:${p.windowIndex}.${p.paneIndex}`;
  return {
    kind: "tmux",
    pid: p.pid,
    raw: p,
    captureTarget: target,
    gotoValue: `${target}  ↵ go`,
    rows: [
      { label: "Session", value: p.session, accent: "accent" },
      { label: "Window", value: `${p.windowIndex}: ${p.windowName}` },
    ],
  };
}

function herdrEntry(p: herdr.HerdrPane): PaneEntry {
  const rows: DetailRow[] = [
    { label: "Workspace", value: p.workspaceLabel, accent: "accent" },
    { label: "Tab", value: p.tabLabel },
  ];
  if (p.title) rows.push({ label: "Title", value: p.title });
  if (p.agent) rows.push({ label: "Agent", value: p.agent, accent: "light" });
  return {
    kind: "herdr",
    pid: p.pid,
    raw: p,
    captureTarget: p.paneId,
    gotoValue: `${p.tabId}  ↵ go`,
    rows,
  };
}

const tmuxHost: PaneHost = {
  kind: "tmux",
  header: "tmux",
  list: () => tmux.listTmuxPanes().map(tmuxEntry),
  capture: (e, n) => tmux.capturePane(e.captureTarget, n),
  goto: (e) => tmux.switchToPane(e.raw as tmux.TmuxPane),
};

const herdrHost: PaneHost = {
  kind: "herdr",
  header: "herdr",
  list: () => herdr.listHerdrPanes().map(herdrEntry),
  capture: (e, n) => herdr.capturePane(e.captureTarget, n),
  goto: (e) => herdr.focusPane(e.raw as herdr.HerdrPane),
};

export function getPaneHost(): PaneHost {
  return herdr.isHerdrAvailable() ? herdrHost : tmuxHost;
}
