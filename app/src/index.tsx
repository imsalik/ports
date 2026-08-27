import { createCliRenderer, type KeyEvent } from "@opentui/core";
import {
  createRoot,
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import { useEffect, useMemo, useState } from "react";

import {
  killProcess,
  listListeningPorts,
  type PortEntry,
} from "./lib/ports";
import {
  getPaneHost,
  findPaneForPid,
  type PaneEntry,
} from "./lib/panes";
import { getProcessInfo, type ProcessInfo } from "./lib/process";
import {
  buildDockerPortIndex,
  getContainerLogs,
  listDockerContainers,
  stopDockerContainer,
  type DockerPortHit,
} from "./lib/docker";
import {
  C,
  applyTheme,
  currentThemeName,
  THEME_NAMES,
} from "./lib/theme";
import { fuzzyScore } from "./lib/fuzzy";

const host = getPaneHost();

type View = "list" | "confirm-kill" | "theme";
type Status = { kind: "info" | "error"; text: string };

// Flatten a port entry (plus any matching docker container) into a single
// string the fuzzy matcher can search across.
function searchHaystack(p: PortEntry, dh?: DockerPortHit): string {
  const parts: string[] = [
    String(p.port),
    p.protocol,
    p.pid != null ? String(p.pid) : "",
    p.command ?? "",
    p.address ?? "",
  ];
  if (dh) {
    parts.push(
      dh.container.name,
      dh.container.image,
      dh.container.shortId,
      dh.container.composeProject ?? "",
      dh.container.composeService ?? "",
    );
  }
  return parts.join(" ");
}

function App() {
  const renderer = useRenderer();
  const dims = useTerminalDimensions();

  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [panes, setPanes] = useState<PaneEntry[]>([]);
  const [dockerIdx, setDockerIdx] = useState<Map<number, DockerPortHit>>(
    new Map(),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<View>("list");
  const [signal, setSignal] = useState<"SIGTERM" | "SIGKILL">("SIGTERM");
  const [confirmChoice, setConfirmChoice] = useState<"yes" | "no">("yes");
  const [status, setStatus] = useState<Status | null>(null);
  const [tick, setTick] = useState(0);
  const [showUnknown, setShowUnknown] = useState(false);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  // Theme picker: which row is highlighted, and the theme to restore on cancel.
  const [themeSel, setThemeSel] = useState(0);
  const [themePrev, setThemePrev] = useState(currentThemeName);
  // C is mutated in place by applyTheme; bump this to force a repaint.
  const [, setThemeTick] = useState(0);
  const repaint = () => setThemeTick((t) => t + 1);

  const basePorts = useMemo(
    () =>
      showUnknown
        ? ports
        : ports.filter((p) => p.pid !== null || dockerIdx.has(p.port)),
    [ports, showUnknown, dockerIdx],
  );

  // Fuzzy-filter and rank by score; falls back to the natural port order
  // when there is no active query.
  const visiblePorts = useMemo(() => {
    const q = query.trim();
    if (!q) return basePorts;
    const scored: { entry: PortEntry; score: number }[] = [];
    for (const p of basePorts) {
      const score = fuzzyScore(q, searchHaystack(p, dockerIdx.get(p.port)));
      if (score !== null) scored.push({ entry: p, score });
    }
    scored.sort((a, b) => b.score - a.score || a.entry.port - b.entry.port);
    return scored.map((s) => s.entry);
  }, [basePorts, query, dockerIdx]);

  const baseCount = basePorts.length;
  const hiddenCount = showUnknown ? 0 : ports.length - baseCount;

  const refresh = () => {
    setPorts(listListeningPorts());
    setPanes(host.list());
    setDockerIdx(buildDockerPortIndex(listDockerContainers()));
    setTick((t) => t + 1);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (selectedIndex >= visiblePorts.length) {
      setSelectedIndex(Math.max(0, visiblePorts.length - 1));
    }
  }, [visiblePorts.length, selectedIndex]);

  // Jump back to the top of the result list whenever the query changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const selected = visiblePorts[selectedIndex] ?? null;

  const procInfo = useMemo<ProcessInfo | null>(() => {
    if (!selected?.pid) return null;
    return getProcessInfo(selected.pid);
  }, [selected?.pid, tick]);

  const pane = useMemo<PaneEntry | null>(() => {
    if (!selected?.pid) return null;
    return findPaneForPid(selected.pid, panes);
  }, [selected?.pid, panes]);

  const paneOutput = useMemo<string[]>(() => {
    if (!pane) return [];
    return host.capture(pane, 10);
  }, [pane?.captureTarget, tick]);

  const dockerHit = useMemo<DockerPortHit | null>(() => {
    if (!selected) return null;
    return dockerIdx.get(selected.port) ?? null;
  }, [selected?.port, dockerIdx]);

  const dockerLogs = useMemo<string[]>(() => {
    if (!dockerHit) return [];
    return getContainerLogs(dockerHit.container.containerId, 10);
  }, [dockerHit?.container.containerId, tick]);

  const navigate = (delta: number) => {
    setSelectedIndex((i) =>
      Math.max(0, Math.min(Math.max(0, visiblePorts.length - 1), i + delta)),
    );
  };
  const selectIndex = (idx: number) => {
    setSelectedIndex(Math.max(0, Math.min(visiblePorts.length - 1, idx)));
  };
  const toggleHidden = () => setShowUnknown((s) => !s);
  const gotoPane = () => {
    if (!pane) return;
    const r = host.goto(pane);
    if (r.ok) {
      renderer.destroy();
    } else {
      setStatus({
        kind: "error",
        text: `${host.kind}: ${r.error ?? "jump failed"}`,
      });
    }
  };
  const openThemePicker = () => {
    setThemePrev(currentThemeName);
    setThemeSel(Math.max(0, THEME_NAMES.indexOf(currentThemeName)));
    setView("theme");
  };
  const previewThemeAt = (i: number) => {
    setThemeSel(i);
    applyTheme(THEME_NAMES[i]!); // live preview (also persists)
    repaint();
  };
  const previewTheme = (delta: number) =>
    previewThemeAt((themeSel + delta + THEME_NAMES.length) % THEME_NAMES.length);
  const commitTheme = () => {
    setStatus({ kind: "info", text: `theme: ${currentThemeName}` });
    setView("list");
  };
  const cancelTheme = () => {
    applyTheme(themePrev); // revert the preview
    repaint();
    setView("list");
  };
  const doRefresh = () => {
    refresh();
    setStatus({ kind: "info", text: "refreshed" });
  };
  const requestKill = (sig: "SIGTERM" | "SIGKILL") => {
    if (selected?.pid || (selected && dockerIdx.has(selected.port))) {
      setSignal(sig);
      setConfirmChoice("yes"); // default to the highlighted "yes"
      setView("confirm-kill");
    }
  };
  const executeKill = () => {
    const dh = selected ? dockerIdx.get(selected.port) : null;
    if (dh) {
      const mode = signal === "SIGKILL" ? "kill" : "stop";
      const r = stopDockerContainer(dh.container.containerId, mode);
      if (r.ok) {
        setStatus({
          kind: "info",
          text: `docker ${mode} ${dh.container.name}`,
        });
        setTimeout(refresh, 500);
      } else {
        setStatus({
          kind: "error",
          text: `docker ${mode} failed: ${r.error ?? "unknown"}`,
        });
      }
    } else if (selected?.pid) {
      const r = killProcess(selected.pid, signal);
      if (r.ok) {
        setStatus({
          kind: "info",
          text: `sent ${signal} to PID ${selected.pid}`,
        });
        setTimeout(refresh, 250);
      } else {
        setStatus({
          kind: "error",
          text: `kill failed: ${r.error ?? "unknown"}`,
        });
      }
    } else {
      setStatus({
        kind: "error",
        text: "no pid available — try with sudo",
      });
    }
    setView("list");
  };

  // Keystrokes while the search input is focused.
  const handleSearchKey = (key: KeyEvent) => {
    if (key.name === "escape") {
      setQuery("");
      setSearchMode(false);
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      setSearchMode(false); // confirm: keep the filter, hand focus back to the list
      return;
    }
    if (key.name === "backspace") {
      setQuery((q) => q.slice(0, -1));
      return;
    }
    if (key.name === "up") {
      navigate(-1);
      return;
    }
    if (key.name === "down") {
      navigate(1);
      return;
    }
    if (key.ctrl && key.name === "u") {
      setQuery("");
      return;
    }
    if (key.ctrl && key.name === "w") {
      setQuery((q) => q.replace(/\s*\S+\s*$/, ""));
      return;
    }
    // Append printable characters.
    const ch = key.sequence;
    if (ch && ch.length === 1 && !key.ctrl && !key.meta) {
      const code = ch.charCodeAt(0);
      if (code >= 0x20 && code !== 0x7f) {
        setQuery((q) => q + ch);
      }
    }
  };

  useKeyboard((key) => {
    if (view === "confirm-kill") {
      if (key.name === "left" || key.name === "right" || key.name === "tab") {
        setConfirmChoice((c) => (c === "yes" ? "no" : "yes"));
        return;
      }
      if (key.name === "enter" || key.name === "return") {
        if (confirmChoice === "yes") executeKill();
        else setView("list");
        return;
      }
      if (key.name === "y") {
        executeKill();
        return;
      }
      if (key.name === "n" || key.name === "escape") {
        setView("list");
        return;
      }
      return;
    }

    if (key.ctrl && key.name === "c") {
      renderer.destroy();
      return;
    }

    if (view === "theme") {
      switch (key.name) {
        case "up":
        case "k":
          previewTheme(-1);
          return;
        case "down":
        case "j":
          previewTheme(1);
          return;
        case "enter":
        case "return":
          commitTheme();
          return;
        case "escape":
        case "q":
          cancelTheme();
          return;
      }
      return;
    }

    if (searchMode) {
      handleSearchKey(key);
      return;
    }

    if (key.name === "/" || key.sequence === "/") {
      setSearchMode(true);
      return;
    }

    switch (key.name) {
      case "q":
        renderer.destroy();
        return;
      case "up":
      case "k":
        navigate(-1);
        return;
      case "down":
      case "j":
        navigate(1);
        return;
      case "pageup":
        navigate(-10);
        return;
      case "pagedown":
        navigate(10);
        return;
      case "home":
        setSelectedIndex(0);
        return;
      case "end":
        setSelectedIndex(Math.max(0, visiblePorts.length - 1));
        return;
      case "r":
        doRefresh();
        return;
      case "t":
        openThemePicker();
        return;
      case "h":
        toggleHidden();
        return;
      case "enter":
      case "return":
      case "g":
        gotoPane();
        return;
      case "x":
        requestKill(key.shift ? "SIGKILL" : "SIGTERM");
        return;
      case "escape":
        if (query) setQuery("");
        return;
    }
  });

  const searchVisible = searchMode || query.length > 0;
  const visibleCount = Math.max(
    5,
    dims.height - 14 - (searchVisible ? 3 : 0),
  );
  const half = Math.floor(visibleCount / 2);
  const maxStart = Math.max(0, visiblePorts.length - visibleCount);
  const start = Math.max(
    0,
    Math.min(maxStart, selectedIndex - half),
  );
  const visible = visiblePorts.slice(start, start + visibleCount);

  return (
    <box
      flexDirection="column"
      backgroundColor={C.bg}
      flexGrow={1}
      paddingX={1}
      paddingY={0}
    >
      <Header total={baseCount} />
      {searchVisible && (
        <SearchBar
          query={query}
          active={searchMode}
          matched={visiblePorts.length}
          total={baseCount}
        />
      )}
      {view === "list" && (
        <Body
          visible={visible}
          start={start}
          total={visiblePorts.length}
          hiddenCount={hiddenCount}
          showUnknown={showUnknown}
          selectedIndex={selectedIndex}
          selected={selected}
          procInfo={procInfo}
          pane={pane}
          paneHeader={host.header}
          paneOutput={paneOutput}
          dockerHit={dockerHit}
          dockerLogs={dockerLogs}
          dockerIdx={dockerIdx}
          paneWidth={Math.max(20, dims.width - 60)}
          onSelect={selectIndex}
          onToggleHidden={toggleHidden}
          onGoto={gotoPane}
          onScroll={(dir, delta) =>
            navigate((dir === "up" ? -1 : 1) * Math.max(1, delta))
          }
        />
      )}
      {view === "confirm-kill" && (
        <ConfirmKill
          port={selected}
          signal={signal}
          dockerHit={dockerHit}
          choice={confirmChoice}
          onHover={setConfirmChoice}
          onConfirm={executeKill}
          onCancel={() => setView("list")}
        />
      )}
      {view === "theme" && (
        <ThemePicker selectedIndex={themeSel} onSelect={previewThemeAt} />
      )}
      <Footer
        status={status}
        canKill={!!(selected?.pid || (selected && dockerIdx.has(selected.port)))}
        canToggleHidden={hiddenCount > 0 || showUnknown}
        canGoto={!!pane}
        showUnknown={showUnknown}
        filtering={query.length > 0}
        onRefresh={doRefresh}
        onSearch={() => setSearchMode(true)}
        onClearSearch={() => {
          setQuery("");
          setSearchMode(false);
        }}
        onKill={() => requestKill("SIGTERM")}
        onForceKill={() => requestKill("SIGKILL")}
        onToggleHidden={toggleHidden}
        onGoto={gotoPane}
        onTheme={openThemePicker}
        onQuit={() => renderer.destroy()}
      />
    </box>
  );
}

function Header({ total }: { total: number }) {
  return (
    <box flexDirection="row" marginBottom={1} marginTop={1}>
      <text fg={C.accent}>
        <strong>▌ PORTS</strong>
        <span fg={C.textDim}> · {total} listening</span>
      </text>
    </box>
  );
}

function SearchBar({
  query,
  active,
  matched,
  total,
}: {
  query: string;
  active: boolean;
  matched: number;
  total: number;
}) {
  return (
    <box
      flexDirection="row"
      border
      borderStyle="single"
      borderColor={active ? C.accent : C.border}
      paddingX={1}
    >
      <text fg={C.accent}>
        <strong>/ </strong>
      </text>
      <box flexGrow={1} flexDirection="row">
        <text fg={C.text}>{query}</text>
        {active && <text fg={C.accent}>▌</text>}
        {active && query.length === 0 && (
          <text fg={C.textDim}> type to filter</text>
        )}
      </box>
      <text fg={matched === 0 ? C.danger : C.textDim}>
        {matched} / {total}
      </text>
    </box>
  );
}

function Body({
  visible,
  start,
  total,
  hiddenCount,
  showUnknown,
  selectedIndex,
  selected,
  procInfo,
  pane,
  paneHeader,
  paneOutput,
  dockerHit,
  dockerLogs,
  dockerIdx,
  paneWidth,
  onSelect,
  onToggleHidden,
  onGoto,
  onScroll,
}: {
  visible: PortEntry[];
  start: number;
  total: number;
  hiddenCount: number;
  showUnknown: boolean;
  selectedIndex: number;
  selected: PortEntry | null;
  procInfo: ProcessInfo | null;
  pane: PaneEntry | null;
  paneHeader: string;
  paneOutput: string[];
  dockerHit: DockerPortHit | null;
  dockerLogs: string[];
  dockerIdx: Map<number, DockerPortHit>;
  paneWidth: number;
  onSelect: (idx: number) => void;
  onToggleHidden: () => void;
  onGoto: () => void;
  onScroll: (dir: "up" | "down", delta: number) => void;
}) {
  return (
    <box flexDirection="row" flexGrow={1} gap={1}>
      <PortList
        visible={visible}
        start={start}
        total={total}
        hiddenCount={hiddenCount}
        showUnknown={showUnknown}
        selectedIndex={selectedIndex}
        dockerIdx={dockerIdx}
        onSelect={onSelect}
        onToggleHidden={onToggleHidden}
        onScroll={onScroll}
      />
      <Details
        port={selected}
        procInfo={procInfo}
        pane={pane}
        paneHeader={paneHeader}
        paneOutput={paneOutput}
        dockerHit={dockerHit}
        dockerLogs={dockerLogs}
        paneWidth={paneWidth}
        onGoto={onGoto}
      />
    </box>
  );
}

function PortList({
  visible,
  start,
  total,
  hiddenCount,
  showUnknown,
  selectedIndex,
  dockerIdx,
  onSelect,
  onToggleHidden,
  onScroll,
}: {
  visible: PortEntry[];
  start: number;
  total: number;
  hiddenCount: number;
  showUnknown: boolean;
  selectedIndex: number;
  dockerIdx: Map<number, DockerPortHit>;
  onSelect: (idx: number) => void;
  onToggleHidden: () => void;
  onScroll: (dir: "up" | "down", delta: number) => void;
}) {
  const more = total - (start + visible.length);
  return (
    <box
      flexDirection="column"
      width={54}
      border
      borderColor={C.border}
      borderStyle="single"
      title=" listening "
      titleAlignment="left"
      paddingX={1}
      onMouseScroll={(e) => {
        const s = e.scroll;
        if (!s) return;
        if (s.direction === "up" || s.direction === "down") {
          onScroll(s.direction, s.delta);
        }
      }}
    >
      <box flexDirection="row" marginBottom={1}>
        <text fg={C.accentDim} width={7}>
          PORT
        </text>
        <text fg={C.accentDim} width={7}>
          PROTO
        </text>
        <text fg={C.accentDim} width={9}>
          PID
        </text>
        <text fg={C.accentDim}>PROCESS</text>
      </box>

      {start > 0 && (
        <text fg={C.textDim}>{`↑ ${start} more`}</text>
      )}

      {visible.length === 0 ? (
        <text fg={C.textDim}>
          <em>no listening ports</em>
        </text>
      ) : (
        visible.map((p, i) => {
          const idx = start + i;
          const sel = idx === selectedIndex;
          const fg = sel ? C.bg : C.text;
          const dimFg = sel ? C.bg : C.textDim;
          const dh = dockerIdx.get(p.port);
          const pidLabel = p.pid?.toString() ?? (dh ? "docker" : "?");
          const cmdLabel = p.command ?? (dh ? dh.container.name : "?");
          const cmdFg = !p.command && dh ? (sel ? C.bg : C.accentLight) : fg;
          return (
            <box
              key={`${p.port}-${p.pid ?? "x"}-${p.protocol}`}
              flexDirection="row"
              backgroundColor={sel ? C.accent : "transparent"}
              onMouseDown={() => onSelect(idx)}
            >
              <text fg={fg} width={7}>
                {String(p.port)}
              </text>
              <text fg={dimFg} width={7}>
                {p.protocol}
              </text>
              <text fg={dimFg} width={9}>
                {pidLabel}
              </text>
              <text fg={cmdFg}>{cmdLabel}</text>
            </box>
          );
        })
      )}

      {more > 0 && (
        <text fg={C.textDim}>{`↓ ${more} more`}</text>
      )}

      {(hiddenCount > 0 || showUnknown) && (
        <box marginTop={1} onMouseDown={onToggleHidden}>
          <text fg={C.accentDim}>
            <span fg={C.accent}>
              <u>h</u>
            </span>{" "}
            {showUnknown ? "hide unknown" : `show ${hiddenCount} hidden`}
          </text>
        </box>
      )}
    </box>
  );
}

function Details({
  port,
  procInfo,
  pane,
  paneHeader,
  paneOutput,
  dockerHit,
  dockerLogs,
  paneWidth,
  onGoto,
}: {
  port: PortEntry | null;
  procInfo: ProcessInfo | null;
  pane: PaneEntry | null;
  paneHeader: string;
  paneOutput: string[];
  dockerHit: DockerPortHit | null;
  dockerLogs: string[];
  paneWidth: number;
  onGoto: () => void;
}) {
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      border
      borderColor={C.border}
      borderStyle="single"
      title=" details "
      titleAlignment="left"
      paddingX={1}
    >
      {!port ? (
        <text fg={C.textDim}>
          <em>select a port</em>
        </text>
      ) : (
        <>
          <Row label="Port" value={`${port.port}`} valueFg={C.accent} />
          <Row label="Proto" value={port.protocol} />
          <Row label="Address" value={port.address || "*"} />
          <Row label="PID" value={port.pid?.toString() ?? "?"} />
          <Row label="User" value={procInfo?.user ?? "—"} />
          <Row
            label="Process"
            value={
              port.command ??
              (dockerHit ? `docker: ${dockerHit.container.name}` : "—")
            }
            valueFg={C.accentLight}
          />

          {dockerHit && (
            <>
              <box marginTop={1} />
              <text fg={C.accentDim}>
                <strong>━━ docker ━━</strong>
              </text>
              <Row
                label="Container"
                value={dockerHit.container.name}
                valueFg={C.accent}
              />
              <Row label="Image" value={dockerHit.container.image} />
              <Row label="ID" value={dockerHit.container.shortId} />
              <Row
                label="Internal"
                value={`${dockerHit.mapping.containerPort}/${dockerHit.mapping.protocol}`}
              />
              <Row
                label="Status"
                value={`${dockerHit.container.state} · ${dockerHit.container.status}`}
              />
              {dockerHit.container.composeProject && (
                <Row
                  label="Project"
                  value={dockerHit.container.composeProject}
                  valueFg={C.accentLight}
                />
              )}
              {dockerHit.container.composeService && (
                <Row
                  label="Service"
                  value={dockerHit.container.composeService}
                />
              )}
            </>
          )}

          {procInfo && (
            <>
              <box marginTop={1} />
              <text fg={C.accentDim}>
                <strong>━━ process ━━</strong>
              </text>
              <Row label="Cmdline" value={procInfo.cmdline} />
              <Row label="Exe" value={procInfo.exe ?? "—"} />
              <Row label="CWD" value={procInfo.cwd ?? "—"} />
              <Row label="PPID" value={procInfo.ppid?.toString() ?? "—"} />
            </>
          )}

          {pane && (
            <>
              <box marginTop={1} />
              <text fg={C.accentDim}>
                <strong>━━ {paneHeader} ━━</strong>
              </text>
              {pane.rows.map((r) => (
                <Row
                  key={r.label}
                  label={r.label}
                  value={r.value}
                  valueFg={
                    r.accent === "accent"
                      ? C.accent
                      : r.accent === "light"
                        ? C.accentLight
                        : undefined
                  }
                />
              ))}
              <box onMouseDown={onGoto}>
                <Row
                  label="Target"
                  value={pane.gotoValue}
                  valueFg={C.accentLight}
                />
              </box>

              <box marginTop={1} />
              <text fg={C.accentDim}>
                <strong>━━ tail ━━</strong>
              </text>
              <LogBox lines={paneOutput} maxWidth={paneWidth} />
            </>
          )}

          {dockerHit && (
            <>
              <box marginTop={1} />
              <text fg={C.accentDim}>
                <strong>━━ tail ━━</strong>
              </text>
              <LogBox lines={dockerLogs} maxWidth={paneWidth} />
            </>
          )}
        </>
      )}
    </box>
  );
}

function LogBox({
  lines,
  maxWidth,
}: {
  lines: string[];
  maxWidth: number;
}) {
  // Inner text width: subtract 2 (borders) + 2 (paddingX) = 4
  const inner = Math.max(10, maxWidth - 4);
  return (
    <box
      border
      borderStyle="single"
      borderColor={C.accentDim}
      backgroundColor={C.surface}
      paddingX={1}
      flexDirection="column"
    >
      {lines.length === 0 ? (
        <text fg={C.textDim}>
          <em>(no output)</em>
        </text>
      ) : (
        lines.map((line, i) => {
          const trimmed =
            line.length > inner ? line.slice(0, inner - 1) + "…" : line;
          return (
            <text key={i} fg={C.accentLight}>
              {trimmed || " "}
            </text>
          );
        })
      )}
    </box>
  );
}

function Row({
  label,
  value,
  valueFg,
}: {
  label: string;
  value: string;
  valueFg?: string;
}) {
  return (
    <box flexDirection="row">
      <text fg={C.textDim} width={10}>
        {label}
      </text>
      <box flexGrow={1} backgroundColor={C.bg}>
        <text fg={valueFg ?? C.text}>{value}</text>
      </box>
    </box>
  );
}

function ConfirmKill({
  port,
  signal,
  dockerHit,
  choice,
  onHover,
  onConfirm,
  onCancel,
}: {
  port: PortEntry | null;
  signal: "SIGTERM" | "SIGKILL";
  dockerHit: DockerPortHit | null;
  choice: "yes" | "no";
  onHover: (c: "yes" | "no") => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isDocker = dockerHit !== null;
  const action = isDocker
    ? signal === "SIGKILL"
      ? "docker kill"
      : "docker stop"
    : signal;
  const target = isDocker
    ? dockerHit.container.name
    : `pid ${port?.pid ?? "?"}${port?.command ? ` (${port.command})` : ""}`;

  const yesSel = choice === "yes";
  const noSel = choice === "no";

  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <box
        border
        borderStyle="double"
        borderColor={C.danger}
        padding={2}
        width={60}
        backgroundColor={C.surface}
        flexDirection="column"
      >
        <text fg={C.danger}>
          <strong>▌ CONFIRM</strong>
        </text>
        <box marginTop={1} />
        <text fg={C.text}>
          run <span fg={C.accentLight}>{action}</span> on{" "}
          <span fg={C.accent}>{target}</span>?
        </text>
        <text fg={C.textDim}>
          listening on port{" "}
          <span fg={C.accent}>{String(port?.port ?? "")}</span>
        </text>
        <box marginTop={1} flexDirection="row" gap={2}>
          <box
            border
            borderStyle="single"
            borderColor={C.danger}
            backgroundColor={yesSel ? C.danger : "transparent"}
            paddingX={2}
            onMouseOver={() => onHover("yes")}
            onMouseDown={onConfirm}
          >
            <text fg={yesSel ? C.surface : C.danger}>
              <strong>{yesSel ? "▶ " : "  "}[y] yes</strong>
            </text>
          </box>
          <box
            border
            borderStyle="single"
            borderColor={noSel ? C.accent : C.border}
            backgroundColor={noSel ? C.accent : "transparent"}
            paddingX={2}
            onMouseOver={() => onHover("no")}
            onMouseDown={onCancel}
          >
            <text fg={noSel ? C.surface : C.text}>
              <strong>{noSel ? "▶ " : "  "}[n] no</strong>
            </text>
          </box>
        </box>
        <box marginTop={1}>
          <text fg={C.textDim}>←→ switch · ↵ confirm · esc cancel</text>
        </box>
      </box>
    </box>
  );
}

// Theme picker overlay: arrow keys preview live (App applies each step), enter
// commits, esc reverts. Rows carry a swatch of each theme's key colors.
function ThemePicker({
  selectedIndex,
  onSelect,
}: {
  selectedIndex: number;
  onSelect: (idx: number) => void;
}) {
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <box
        border
        borderStyle="double"
        borderColor={C.accent}
        padding={2}
        width={44}
        backgroundColor={C.surface}
        flexDirection="column"
      >
        <text fg={C.accent}>
          <strong>▌ THEME</strong>
        </text>
        <box marginTop={1} />
        {THEME_NAMES.map((name, i) => {
          const sel = i === selectedIndex;
          return (
            <box
              key={name}
              paddingX={1}
              backgroundColor={sel ? C.accent : "transparent"}
              onMouseOver={() => onSelect(i)}
            >
              <text fg={sel ? C.bg : C.text}>
                {(sel ? "▸ " : "  ") + name}
              </text>
            </box>
          );
        })}
        <box marginTop={1}>
          <text fg={C.textDim}>↑↓ preview · ↵ apply · esc cancel</text>
        </box>
      </box>
    </box>
  );
}

function Footer({
  status,
  canKill,
  canToggleHidden,
  canGoto,
  showUnknown,
  filtering,
  onRefresh,
  onSearch,
  onClearSearch,
  onKill,
  onForceKill,
  onToggleHidden,
  onGoto,
  onTheme,
  onQuit,
}: {
  status: Status | null;
  canKill: boolean;
  canToggleHidden: boolean;
  canGoto: boolean;
  showUnknown: boolean;
  filtering: boolean;
  onRefresh: () => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onKill: () => void;
  onForceKill: () => void;
  onToggleHidden: () => void;
  onGoto: () => void;
  onTheme: () => void;
  onQuit: () => void;
}) {
  return (
    <box flexDirection="column" marginTop={1}>
      {status ? (
        <text fg={status.kind === "error" ? C.danger : C.accentDim}>
          {status.kind === "error" ? "✗ " : "✓ "}
          {status.text}
        </text>
      ) : (
        <text> </text>
      )}
      <box flexDirection="row" gap={2}>
        <Key k="↑↓" desc="nav" />
        <Key
          k="/"
          desc={filtering ? "edit filter" : "search"}
          onClick={onSearch}
        />
        {filtering && (
          <Key k="esc" desc="clear" onClick={onClearSearch} />
        )}
        <Key k="r" desc="refresh" onClick={onRefresh} />
        {canGoto && (
          <Key k="↵" desc="go to pane" onClick={onGoto} />
        )}
        <Key
          k="x"
          desc="kill TERM"
          onClick={onKill}
          enabled={canKill}
        />
        <Key
          k="X"
          desc="kill -9"
          onClick={onForceKill}
          enabled={canKill}
        />
        {canToggleHidden && (
          <Key
            k="h"
            desc={showUnknown ? "hide unknown" : "show all"}
            onClick={onToggleHidden}
          />
        )}
        <Key k="t" desc="theme" onClick={onTheme} />
        <Key k="q" desc="quit" onClick={onQuit} />
      </box>
    </box>
  );
}

function Key({
  k,
  desc,
  onClick,
  enabled = true,
}: {
  k: string;
  desc: string;
  onClick?: () => void;
  enabled?: boolean;
}) {
  const fg = enabled ? C.accent : C.accentDim;
  const descFg = enabled ? C.textDim : C.accentDim;
  return (
    <box onMouseDown={enabled && onClick ? onClick : undefined}>
      <text>
        <span fg={fg}>
          <u>{k}</u>
        </span>
        <span fg={descFg}> {desc}</span>
      </text>
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
