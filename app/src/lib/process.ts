import { spawnSync } from "node:child_process";
import fs from "node:fs";

export interface ProcessInfo {
  pid: number;
  ppid: number | null;
  cmdline: string;
  exe: string | null;
  cwd: string | null;
  user: string | null;
}

const IS_DARWIN = process.platform === "darwin";

// ---------- Linux (/proc) ----------

function readPpidLinux(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const lastParen = stat.lastIndexOf(")");
    if (lastParen === -1) return null;
    const fields = stat.substring(lastParen + 2).split(" ");
    const ppid = Number.parseInt(fields[1] ?? "", 10);
    return Number.isFinite(ppid) ? ppid : null;
  } catch {
    return null;
  }
}

const userCache = new Map<string, string>();
function lookupUser(uid: string): string | null {
  if (userCache.has(uid)) return userCache.get(uid)!;
  const result = spawnSync("id", ["-nu", uid], { encoding: "utf8" });
  if (result.status === 0) {
    const name = result.stdout.trim();
    userCache.set(uid, name);
    return name;
  }
  return null;
}

function getProcessInfoLinux(pid: number): ProcessInfo | null {
  let cmdline = "";
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    cmdline = raw.replace(/\0/g, " ").trim();
  } catch {
    return null;
  }

  let exe: string | null = null;
  try {
    exe = fs.readlinkSync(`/proc/${pid}/exe`);
  } catch {}

  let cwd: string | null = null;
  try {
    cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {}

  const ppid = readPpidLinux(pid);

  let user: string | null = null;
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const uidLine = status.split("\n").find((l) => l.startsWith("Uid:"));
    if (uidLine) {
      const uid = uidLine.split(/\s+/)[1];
      if (uid) user = lookupUser(uid);
    }
  } catch {}

  return {
    pid,
    ppid,
    cmdline: cmdline || "(unknown)",
    exe,
    cwd,
    user,
  };
}

function getAncestorPidsLinux(pid: number, maxDepth = 30): number[] {
  const ancestors: number[] = [];
  let current = pid;
  for (let i = 0; i < maxDepth; i++) {
    const ppid = readPpidLinux(current);
    if (ppid === null || ppid <= 1) break;
    ancestors.push(ppid);
    current = ppid;
  }
  return ancestors;
}

// ---------- Darwin (ps + lsof) ----------

function psField(pid: number, fmt: string): string | null {
  const r = spawnSync("ps", ["-ww", "-o", `${fmt}=`, "-p", String(pid)], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  const s = r.stdout.replace(/\n$/, "");
  return s.length ? s : null;
}

function readPpidDarwin(pid: number): number | null {
  const s = psField(pid, "ppid");
  if (!s) return null;
  const n = Number.parseInt(s.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function readCwdDarwin(pid: number): string | null {
  // -a AND -d cwd -p <pid>; -Fn => "p<pid>\nn<cwd>"
  const r = spawnSync(
    "lsof",
    ["-a", "-d", "cwd", "-Fn", "-p", String(pid)],
    { encoding: "utf8" },
  );
  if (r.status !== 0 && r.status !== 1) return null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("n")) return line.substring(1);
  }
  return null;
}

function getProcessInfoDarwin(pid: number): ProcessInfo | null {
  // Single batched ps call for the simple fields.
  // Format: "<ppid> <user> <comm>" — comm is last so any spaces in path stay intact.
  const r = spawnSync(
    "ps",
    ["-ww", "-o", "ppid=,user=,comm=", "-p", String(pid)],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !r.stdout.trim()) return null;

  const line = r.stdout.replace(/\n$/, "").trimStart();
  const m = line.match(/^(\d+)\s+(\S+)\s+(.+)$/);
  if (!m) return null;
  const ppid = Number.parseInt(m[1]!, 10);
  const user = m[2]!;
  const exe = m[3]!;

  const cmdline = psField(pid, "args") ?? exe;
  const cwd = readCwdDarwin(pid);

  return {
    pid,
    ppid: Number.isFinite(ppid) ? ppid : null,
    cmdline: cmdline || "(unknown)",
    exe,
    cwd,
    user,
  };
}

function getAncestorPidsDarwin(pid: number, maxDepth = 30): number[] {
  const ancestors: number[] = [];
  let current = pid;
  for (let i = 0; i < maxDepth; i++) {
    const ppid = readPpidDarwin(current);
    if (ppid === null || ppid <= 1) break;
    ancestors.push(ppid);
    current = ppid;
  }
  return ancestors;
}

// ---------- Dispatch ----------

export function getProcessInfo(pid: number): ProcessInfo | null {
  return IS_DARWIN ? getProcessInfoDarwin(pid) : getProcessInfoLinux(pid);
}

export function getAncestorPids(pid: number, maxDepth = 30): number[] {
  return IS_DARWIN
    ? getAncestorPidsDarwin(pid, maxDepth)
    : getAncestorPidsLinux(pid, maxDepth);
}
