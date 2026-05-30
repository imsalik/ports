// Lightweight fzf-style fuzzy matcher — no dependencies.
//
// The query is split on whitespace into tokens; every token must match the
// haystack as an ordered subsequence (AND), and the overall score is the sum
// of the per-token scores. Returns null when any token fails to match, so it
// doubles as the filter predicate. Higher score == better match.

function matchToken(token: string, text: string): number | null {
  let score = 0;
  let from = 0;
  let prev = -2;
  let run = 0; // length of the current consecutive-match run
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]!;
    const idx = text.indexOf(ch, from);
    if (idx === -1) return null;
    if (idx === prev + 1) {
      run += 1;
      score += 8 + run * 4; // longer consecutive runs are worth progressively more
    } else {
      run = 0;
      score += 1;
      score -= Math.min(3, idx - from); // small penalty for skipped gaps
    }
    const before = idx > 0 ? text[idx - 1]! : "";
    if (idx === 0 || /[\s\-_./:@]/.test(before)) {
      score += 10; // bonus for matching at a word boundary
    }
    prev = idx;
    from = idx + 1;
  }
  return score;
}

export function fuzzyScore(query: string, text: string): number | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const hay = text.toLowerCase();
  let total = 0;
  for (const tok of tokens) {
    const s = matchToken(tok, hay);
    if (s === null) return null;
    total += s;
  }
  return total;
}
