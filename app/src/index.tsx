import { createCliRenderer } from "@opentui/core";
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
  capturePane,
  findTmuxPaneForPid,
  listTmuxPanes,
  type TmuxPane,
} from "./lib/tmux";
import { getProcessInfo, type ProcessInfo } from "./lib/process";
import {
  buildDockerPortIndex,
  getContainerLogs,
  listDockerContainers,
  stopDockerContainer,
  type DockerPortHit,
} from "./lib/docker";

const C = {
  mustard: "#D4A017",
  mustardLight: "#F2C94C",
  mustardDim: "#8A6D14",
  bg: "#0F0F0F",
  surface: "#1A1A1A",
  text: "#E8E0CC",
  textDim: "#7A7468",
  danger: "#D86A4A",
  border: "#3A3530",
};

type View = "list" | "confirm-kill";
type Status = { kind: "info" | "error"; text: string };

function App() {
  const renderer = useRenderer();
  const dims = useTerminalDimensions();

  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [panes, setPanes] = useState<TmuxPane[]>([]);
  const [dockerIdx, setDockerIdx] = useState<Map<number, DockerPortHit>>(
    new Map(),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<View>("list");
  const [signal, setSignal] = useState<"SIGTERM" | "SIGKILL">("SIGTERM");
  const [status, setStatus] = useState<Status | null>(null);
  const [tick, setTick] = useState(0);
  const [showUnknown, setShowUnknown] = useState(false);

  const visiblePorts = useMemo(
    () =>
      showUnknown
        ? ports
        : ports.filter((p) => p.pid !== null || dockerIdx.has(p.port)),
    [ports, showUnknown, dockerIdx],
  );
  const hiddenCount = ports.length - visiblePorts.length;

  const refresh = () => {
    setPorts(listListeningPorts());
    setPanes(listTmuxPanes());
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

  const selected = visiblePorts[selectedIndex] ?? null;

  const procInfo = useMemo<ProcessInfo | null>(() => {
    if (!selected?.pid) return null;
    return getProcessInfo(selected.pid);
  }, [selected?.pid, tick]);

  const tmuxPane = useMemo<TmuxPane | null>(() => {
    if (!selected?.pid) return null;
    return findTmuxPaneForPid(selected.pid, panes);
  }, [selected?.pid, panes]);

  const paneOutput = useMemo<string[]>(() => {
    if (!tmuxPane) return [];
    const target = `${tmuxPane.session}:${tmuxPane.windowIndex}.${tmuxPane.paneIndex}`;
    return capturePane(target, 10);
  }, [tmuxPane?.paneId, tick]);

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
  const doRefresh = () => {
    refresh();
    setStatus({ kind: "info", text: "refreshed" });
  };
  const requestKill = (sig: "SIGTERM" | "SIGKILL") => {
    if (selected?.pid || (selected && dockerIdx.has(selected.port))) {
      setSignal(sig);
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

  useKeyboard((key) => {
    if (view === "confirm-kill") {
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
      case "h":
        toggleHidden();
        return;
      case "x":
        requestKill(key.shift ? "SIGKILL" : "SIGTERM");
        return;
    }
  });

  const visibleCount = Math.max(5, dims.height - 14);
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
      <Header total={visiblePorts.length} />
      {view === "list" ? (
        <Body
          visible={visible}
          start={start}
          total={visiblePorts.length}
          hiddenCount={hiddenCount}
          showUnknown={showUnknown}
          selectedIndex={selectedIndex}
          selected={selected}
          procInfo={procInfo}
          tmuxPane={tmuxPane}
          paneOutput={paneOutput}
          dockerHit={dockerHit}
          dockerLogs={dockerLogs}
          dockerIdx={dockerIdx}
          paneWidth={Math.max(20, dims.width - 50)}
          onSelect={selectIndex}
          onToggleHidden={toggleHidden}
          onScroll={(dir, delta) =>
            navigate((dir === "up" ? -1 : 1) * Math.max(1, delta))
          }
        />
      ) : (
        <ConfirmKill
          port={selected}
          signal={signal}
          dockerHit={dockerHit}
          onConfirm={executeKill}
          onCancel={() => setView("list")}
        />
      )}
      <Footer
        status={status}
        canKill={!!(selected?.pid || (selected && dockerIdx.has(selected.port)))}
        canToggleHidden={hiddenCount > 0 || showUnknown}
        showUnknown={showUnknown}
        onRefresh={doRefresh}
        onKill={() => requestKill("SIGTERM")}
        onForceKill={() => requestKill("SIGKILL")}
        onToggleHidden={toggleHidden}
        onQuit={() => renderer.destroy()}
      />
    </box>
  );
}

function Header({ total }: { total: number }) {
  return (
    <box flexDirection="row" marginBottom={1} marginTop={1}>
      <text fg={C.mustard}>
        <strong>▌ PORTS</strong>
        <span fg={C.textDim}> · {total} listening</span>
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
  tmuxPane,
  paneOutput,
  dockerHit,
  dockerLogs,
  dockerIdx,
  paneWidth,
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
  selected: PortEntry | null;
  procInfo: ProcessInfo | null;
  tmuxPane: TmuxPane | null;
  paneOutput: string[];
  dockerHit: DockerPortHit | null;
  dockerLogs: string[];
  dockerIdx: Map<number, DockerPortHit>;
  paneWidth: number;
  onSelect: (idx: number) => void;
  onToggleHidden: () => void;
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
        tmuxPane={tmuxPane}
        paneOutput={paneOutput}
        dockerHit={dockerHit}
        dockerLogs={dockerLogs}
        paneWidth={paneWidth}
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
      width={44}
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
        <text fg={C.mustardDim} width={8}>
          PORT
        </text>
        <text fg={C.mustardDim} width={6}>
          PROTO
        </text>
        <text fg={C.mustardDim} width={8}>
          PID
        </text>
        <text fg={C.mustardDim}>PROCESS</text>
      </box>

      {start > 0 && (
        <text fg={C.textDim}>{`  ↑ ${start} more`}</text>
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
          const cmdFg = !p.command && dh ? (sel ? C.bg : C.mustardLight) : fg;
          return (
            <box
              key={`${p.port}-${p.pid ?? "x"}-${p.protocol}`}
              flexDirection="row"
              backgroundColor={sel ? C.mustard : "transparent"}
              onMouseDown={() => onSelect(idx)}
            >
              <text fg={fg} width={8}>
                {sel ? "▶ " : "  "}
                {String(p.port).padEnd(6)}
              </text>
              <text fg={dimFg} width={6}>
                {p.protocol}
              </text>
              <text fg={dimFg} width={8}>
                {pidLabel}
              </text>
              <text fg={cmdFg}>{cmdLabel}</text>
            </box>
          );
        })
      )}

      {more > 0 && (
        <text fg={C.textDim}>{`  ↓ ${more} more`}</text>
      )}

      {(hiddenCount > 0 || showUnknown) && (
        <box marginTop={1} onMouseDown={onToggleHidden}>
          <text fg={C.mustardDim}>
            {"  "}
            <span fg={C.mustard}>
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
  tmuxPane,
  paneOutput,
  dockerHit,
  dockerLogs,
  paneWidth,
}: {
  port: PortEntry | null;
  procInfo: ProcessInfo | null;
  tmuxPane: TmuxPane | null;
  paneOutput: string[];
  dockerHit: DockerPortHit | null;
  dockerLogs: string[];
  paneWidth: number;
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
          <Row label="Port" value={`${port.port}`} valueFg={C.mustard} />
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
            valueFg={C.mustardLight}
          />

          {dockerHit && (
            <>
              <box marginTop={1} />
              <text fg={C.mustardDim}>
                <strong>━━ docker ━━</strong>
              </text>
              <Row
                label="Container"
                value={dockerHit.container.name}
                valueFg={C.mustard}
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
                  valueFg={C.mustardLight}
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
              <text fg={C.mustardDim}>
                <strong>━━ process ━━</strong>
              </text>
              <Row label="Cmdline" value={procInfo.cmdline} />
              <Row label="Exe" value={procInfo.exe ?? "—"} />
              <Row label="CWD" value={procInfo.cwd ?? "—"} />
              <Row label="PPID" value={procInfo.ppid?.toString() ?? "—"} />
            </>
          )}

          {tmuxPane && (
            <>
              <box marginTop={1} />
              <text fg={C.mustardDim}>
                <strong>━━ tmux ━━</strong>
              </text>
              <Row
                label="Session"
                value={tmuxPane.session}
                valueFg={C.mustard}
              />
              <Row
                label="Window"
                value={`${tmuxPane.windowIndex}: ${tmuxPane.windowName}`}
              />
              <Row
                label="Pane"
                value={`${tmuxPane.paneId} (${tmuxPane.command})`}
              />
              <Row
                label="Target"
                value={`${tmuxPane.session}:${tmuxPane.windowIndex}.${tmuxPane.paneIndex}`}
                valueFg={C.mustardLight}
              />

              <box marginTop={1} />
              <text fg={C.mustardDim}>
                <strong>━━ tail ━━</strong>
              </text>
              <LogBox lines={paneOutput} maxWidth={paneWidth} />
            </>
          )}

          {dockerHit && (
            <>
              <box marginTop={1} />
              <text fg={C.mustardDim}>
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
      borderColor={C.mustardDim}
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
            <text key={i} fg={C.mustardLight}>
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
      <text fg={valueFg ?? C.text}>{value}</text>
    </box>
  );
}

function ConfirmKill({
  port,
  signal,
  dockerHit,
  onConfirm,
  onCancel,
}: {
  port: PortEntry | null;
  signal: "SIGTERM" | "SIGKILL";
  dockerHit: DockerPortHit | null;
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
          <strong>⚠  CONFIRM</strong>
        </text>
        <box marginTop={1} />
        <text fg={C.text}>
          run <span fg={C.mustardLight}>{action}</span> on{" "}
          <span fg={C.mustard}>{target}</span>?
        </text>
        <text fg={C.textDim}>
          listening on port{" "}
          <span fg={C.mustard}>{String(port?.port ?? "")}</span>
        </text>
        <box marginTop={1} flexDirection="row" gap={2}>
          <box
            border
            borderStyle="single"
            borderColor={C.danger}
            paddingX={2}
            onMouseDown={onConfirm}
          >
            <text fg={C.danger}>
              <strong>[y] yes</strong>
            </text>
          </box>
          <box
            border
            borderStyle="single"
            borderColor={C.border}
            paddingX={2}
            onMouseDown={onCancel}
          >
            <text fg={C.text}>[n] no</text>
          </box>
        </box>
      </box>
    </box>
  );
}

function Footer({
  status,
  canKill,
  canToggleHidden,
  showUnknown,
  onRefresh,
  onKill,
  onForceKill,
  onToggleHidden,
  onQuit,
}: {
  status: Status | null;
  canKill: boolean;
  canToggleHidden: boolean;
  showUnknown: boolean;
  onRefresh: () => void;
  onKill: () => void;
  onForceKill: () => void;
  onToggleHidden: () => void;
  onQuit: () => void;
}) {
  return (
    <box flexDirection="column" marginTop={1}>
      {status ? (
        <text fg={status.kind === "error" ? C.danger : C.mustardDim}>
          {status.kind === "error" ? "✗ " : "✓ "}
          {status.text}
        </text>
      ) : (
        <text> </text>
      )}
      <box flexDirection="row" gap={2}>
        <Key k="↑↓" desc="nav" />
        <Key k="r" desc="refresh" onClick={onRefresh} />
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
  const fg = enabled ? C.mustard : C.mustardDim;
  const descFg = enabled ? C.textDim : C.mustardDim;
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
