// Nerd Font glyphs for the process / container column. Requires a Nerd Font in
// the terminal (the tmux/herdr popups run under one). Unknown processes fall
// back to a plain bullet, which renders everywhere, so a missing font only ever
// costs the tech glyphs, never layout. Glyphs are given as codepoints so the
// source stays ASCII and each icon is reviewable.

import { loadConfig } from "./config";

const g = (cp: number) => String.fromCodePoint(cp);

// Whether to draw Nerd Font icons at all. Off drops the icon column entirely so
// nothing shifts. Order: PORTS_ICONS env → config → on.
export function iconsEnabled(): boolean {
  const env = process.env.PORTS_ICONS;
  if (env != null) return !/^(0|false|off|no)$/i.test(env.trim());
  return loadConfig().icons !== false;
}

export interface Icon {
  glyph: string;
  known: boolean; // known tech → accent color; fallback bullet → dim
}

const FALLBACK = "•"; // bullet — always renders

// First match wins, so order specific patterns before broad ones. Matched
// against a lowercased "command image container" haystack. Codepoints are Nerd
// Font Devicons / Font Awesome.
const RULES: [RegExp, number][] = [
  [/docker|containerd|compose/, 0xe7b0],
  [/postgres|psql|\bpg\b/, 0xe76e],
  [/mysql|mariadb/, 0xe704],
  [/redis/, 0xe76d],
  [/mongo/, 0xe7a4],
  [/nginx/, 0xe776],
  [/python|uvicorn|gunicorn|flask|django|poetry|\bpip\b|celery/, 0xe73c],
  [/\bgo\b|golang/, 0xe724],
  [/rust|cargo/, 0xe7a8],
  [/ruby|rails|puma|\brake\b/, 0xe739],
  [/java|gradle|kotlin|\bmvn\b/, 0xe738],
  [/dotnet|csharp/, 0xe77f],
  [/elixir|phoenix|beam\.smp/, 0xe62d],
  [/\bphp\b/, 0xe73d],
  [/react|next|nuxt|vite/, 0xe7ba],
  [/node|npm|npx|pnpm|yarn|deno|\btsx?\b|bun/, 0xe718],
  [/\bsshd?\b/, 0xf023],
];

// Resolve an icon from any descriptive strings (command, docker image, etc.).
export function iconFor(...parts: (string | null | undefined)[]): Icon {
  const hay = parts.filter(Boolean).join(" ").toLowerCase();
  for (const [re, cp] of RULES) {
    if (re.test(hay)) return { glyph: g(cp), known: true };
  }
  return { glyph: FALLBACK, known: false };
}

// Section-heading glyphs for the details panel.
export const HEADING = {
  process: g(0xf085), // cogs
  docker: g(0xe7b0),
  tmux: g(0xf120), // terminal
  herdr: g(0xf0db), // columns
  tail: g(0xf036), // align-left
} as const;

// A plug, for the app title.
export const PLUG = g(0xf1e6);
