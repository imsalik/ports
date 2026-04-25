import { spawnSync } from "node:child_process";

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
  const proc = spawnSync("tmux", ["show-option", "-gqv", name], {
    encoding: "utf8",
    timeout: 500,
  });
  if (proc.status !== 0) return null;
  const v = proc.stdout.trim();
  return v || null;
}

export function loadTheme(): Theme {
  const requested =
    readTmuxOption("@ports-theme") || process.env.PORTS_THEME || "mustard";
  return themes[requested] ?? themes.mustard!;
}
