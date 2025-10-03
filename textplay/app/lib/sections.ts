export type Section = {
  id: string;
  index: number;
  start: number; // char offset (inclusive)
  end: number; // char offset (exclusive)
  text: string;
  approxTokens: number;
  title: string; // placeholder, e.g. "Section 1"
};

export type SplitOptions = {
  // Approximate tokens per section (configurable). Defaults to env or fallback.
  tokensPerSection?: number;
  // Average characters per token used for approximation. Common heuristic ~4.
  charsPerToken?: number;
};

/**
 * Approximate token count by character length heuristic.
 * Default heuristic: 1 token ~= 4 characters.
 */
export function approxTokens(text: string, charsPerToken: number = 4): number {
  // Trim to avoid counting leading/trailing whitespace unnecessarily
  const len = text ? text.trim().length : 0;
  return Math.max(0, Math.ceil(len / Math.max(1, Math.floor(charsPerToken))));
}

/**
 * Split a large text into sections based on an approximate token budget per section.
 * Tries to prefer splitting on soft boundaries (double newlines or sentence punctuation)
 * near the target split position, with a small backward search window.
 *
 * This is a simple, placeholder splitter designed to be replaced later with
 * semantic/structural chunking. It carries offsets so we can evolve toward an index.
 */
export function splitIntoSections(
  fullText: string,
  opts: SplitOptions = {},
): Section[] {
  const DEFAULT_LIMIT =
    (typeof process !== 'undefined' &&
      (process.env as any)?.NEXT_PUBLIC_SECTION_TOKEN_LIMIT &&
      Number((process.env as any).NEXT_PUBLIC_SECTION_TOKEN_LIMIT)) ||
    260000; // default under 260k as a conservative starting point

  const tokensPerSection = Math.max(1, Math.floor(opts.tokensPerSection ?? DEFAULT_LIMIT));
  const charsPerToken = Math.max(1, Math.floor(opts.charsPerToken ?? 4));
  const charBudget = tokensPerSection * charsPerToken;

  const text = fullText ?? '';
  const totalLen = text.length;
  if (!text.trim()) {
    return [
      {
        id: 'section-0',
        index: 0,
        start: 0,
        end: 0,
        text: '',
        approxTokens: 0,
        title: 'Section 1',
      },
    ];
  }

  // Small helper to find a nice break point near a target end within a backward window
  function findBoundary(start: number, targetEnd: number): number {
    const hardEnd = Math.min(totalLen, targetEnd);
    if (hardEnd >= totalLen) return totalLen;

    // Search backwards up to this many characters to find a boundary
    const BACK_WINDOW = 2000;

    const windowStart = Math.max(start, hardEnd - BACK_WINDOW);
    const slice = text.slice(windowStart, Math.min(totalLen, hardEnd + 1));
    const relativeTarget = hardEnd - windowStart;

    // Candidates: double newline, sentence punctuation followed by space/newline
    const candidates: number[] = [];

    // Double newline
    {
      const idx = slice.lastIndexOf('\n\n', relativeTarget);
      if (idx >= 0) candidates.push(idx + 2); // include the separator
    }
    // Sentence enders
    {
      // Find the last occurrence of punctuation followed by space/newline
      // We'll approximate by searching last period/question/exclamation near target
      const puncts = ['. ', '? ', '! ', '.\n', '?\n', '!\n'];
      let best = -1;
      for (const p of puncts) {
        const idx = slice.lastIndexOf(p, relativeTarget);
        if (idx > best) best = idx;
      }
      if (best >= 0) candidates.push(best + 2); // include punctuation + space/newline
    }

    if (candidates.length > 0) {
      const chosen = Math.max(...candidates);
      return windowStart + chosen;
    }

    // Fallback: break exactly at targetEnd
    return hardEnd;
  }

  const sections: Section[] = [];
  let start = 0;
  let index = 0;

  while (start < totalLen) {
    const targetEnd = start + charBudget;
    const end = findBoundary(start, targetEnd);
    const segment = text.slice(start, end);

    sections.push({
      id: `section-${index}`,
      index,
      start,
      end,
      text: segment,
      approxTokens: approxTokens(segment, charsPerToken),
      title: `Section ${index + 1}`,
    });

    start = end;
    index += 1;
  }

  // Safety: if somehow no sections were produced, add one
  if (sections.length === 0) {
    sections.push({
      id: 'section-0',
      index: 0,
      start: 0,
      end: totalLen,
      text,
      approxTokens: approxTokens(text, charsPerToken),
      title: 'Section 1',
    });
  }

  return sections;
}
