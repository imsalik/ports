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

function readPpid(pid: number): number | null {
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

export function getProcessInfo(pid: number): ProcessInfo | null {
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

  const ppid = readPpid(pid);

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

export function getAncestorPids(pid: number, maxDepth = 30): number[] {
  const ancestors: number[] = [];
  let current = pid;
  for (let i = 0; i < maxDepth; i++) {
    const ppid = readPpid(current);
    if (ppid === null || ppid <= 1) break;
    ancestors.push(ppid);
    current = ppid;
  }
  return ancestors;
}
