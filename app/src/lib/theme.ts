import { spawnSync } from "node:child_process";

import { loadConfig, saveConfig } from "./config";

export interface Theme {
  bg: string;
  surface: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentLight: string;
  accentDim: string;
  danger: string;
}

export const themes: Record<string, Theme> = {
  mustard: {
    bg: "#0F0F0F",
    surface: "#1A1A1A",
    border: "#3A3530",
    text: "#E8E0CC",
    textDim: "#7A7468",
    accent: "#D4A017",
    accentLight: "#F2C94C",
    accentDim: "#8A6D14",
    danger: "#D86A4A",
  },
  dracula: {
    bg: "#282A36",
    surface: "#343746",
    border: "#44475A",
    text: "#F8F8F2",
    textDim: "#6272A4",
    accent: "#BD93F9",
    accentLight: "#FF79C6",
    accentDim: "#6272A4",
    danger: "#FF5555",
  },
  gruvbox: {
    bg: "#1D2021",
    surface: "#282828",
    border: "#504945",
    text: "#EBDBB2",
    textDim: "#928374",
    accent: "#D79921",
    accentLight: "#FABD2F",
    accentDim: "#7C6F64",
    danger: "#CC241D",
  },
  catppuccin: {
    bg: "#1E1E2E",
    surface: "#313244",
    border: "#45475A",
    text: "#CDD6F4",
    textDim: "#6C7086",
    accent: "#CBA6F7",
    accentLight: "#F5C2E7",
    accentDim: "#7F849C",
    danger: "#F38BA8",
  },
  nord: {
    bg: "#2E3440",
    surface: "#3B4252",
    border: "#4C566A",
    text: "#ECEFF4",
    textDim: "#677691",
    accent: "#88C0D0",
    accentLight: "#8FBCBB",
    accentDim: "#5E81AC",
    danger: "#BF616A",
  },
  mono: {
    bg: "#0A0A0A",
    surface: "#161616",
    border: "#333333",
    text: "#E5E5E5",
    textDim: "#777777",
    accent: "#FFFFFF",
    accentLight: "#FFFFFF",
    accentDim: "#888888",
    danger: "#E5E5E5",
  },
};

function readTmuxOption(name: string): string | null {
  // Only worth a spawn when we're actually inside tmux.
  if (!process.env.TMUX) return null;
  const proc = spawnSync("tmux", ["show-option", "-gqv", name], {
    encoding: "utf8",
    timeout: 500,
  });
  if (proc.status !== 0) return null;
  const v = proc.stdout.trim();
  return v || null;
}

// Resolution order, highest priority first:
//   PORTS_THEME env     explicit per-launch override
//   config.theme        the remembered in-app choice (persists, tmux or not)
//   @ports-theme tmux   the tmux-plugin default
//   mustard             built-in fallback
export function resolveThemeName(): string {
  return (
    process.env.PORTS_THEME ||
    loadConfig().theme ||
    readTmuxOption("@ports-theme") ||
    "mustard"
  );
}

export function loadTheme(): Theme {
  return themes[resolveThemeName()] ?? themes.mustard!;
}

// The active theme. Resolved once at startup, but components read C's *fields*
// at render time, so switching themes in-app is just an in-place field swap
// (Object.assign) plus a re-render — no prop threading, no reload.
export const C: Theme = { ...loadTheme() };

// The name currently applied to C, for the UI to highlight the active theme.
export let currentThemeName = resolveThemeName();

// Apply a theme by name: mutate C in place (so every `C.x` reference updates),
// remember it in config, and report success. Unknown names are a no-op.
export function applyTheme(name: string): boolean {
  const t = themes[name];
  if (!t) return false;
  Object.assign(C, t);
  currentThemeName = name;
  saveConfig({ theme: name });
  return true;
}

export const THEME_NAMES = Object.keys(themes);
