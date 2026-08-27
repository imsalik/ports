// Persistent user config, stored as JSON. Currently just the remembered theme,
// but structured so future preferences drop in the same way.
//
// Location — a single XDG dir, ghostty/kate-style, so everything ports lives
// together and the theme sticks without depending on tmux:
//   $PORTS_CONFIG                      explicit override (full path to a .json)
//   $XDG_CONFIG_HOME/ports/config.json (default: ~/.config/ports/config.json)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface PortsConfig {
  // The remembered theme name (themes registry key). In-app theme changes write
  // here so the choice survives across launches, tmux or not.
  theme?: string;
}

function resolvePath(): string {
  if (process.env.PORTS_CONFIG) return process.env.PORTS_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "ports", "config.json");
}

export const CONFIG_DIR = dirname(resolvePath());
export const CONFIG_PATH = resolvePath();

let cache: PortsConfig | null = null;

export function loadConfig(): PortsConfig {
  if (cache) return cache;
  try {
    if (existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      cache = parsed && typeof parsed === "object" ? parsed : {};
    } else {
      cache = {};
    }
  } catch {
    // A corrupt config shouldn't stop ports from starting — start fresh.
    cache = {};
  }
  return cache!;
}

// Merge a partial update into the config and persist it. Best-effort: a write
// failure (read-only fs, etc.) is swallowed so it never crashes the UI.
export function saveConfig(patch: Partial<PortsConfig>): void {
  const next = { ...loadConfig(), ...patch };
  cache = next;
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch {
    /* best-effort persistence */
  }
}
