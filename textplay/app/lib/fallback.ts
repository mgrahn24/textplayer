export type SimpleChunk = { text: string; complexity: number };

/**
 * Compute a simple heuristic complexity score in [0,1].
 * Factors: avg word length, punctuation density, digit density, uppercase density.
 */
export function simpleComplexity(text: string): number {
  const s = text || '';
  const len = s.length || 1;
  const words = s.trim().split(/\s+/).filter(Boolean);
  const avgWordLen = words.length ? words.reduce((a, w) => a + w.length, 0) / words.length : 0;

  let punct = 0;
  let digits = 0;
  let upper = 0;
  for (let i = 0; i < len; i++) {
    const c = s[i];
    if (/[.,;:!?()'"\-]/.test(c)) punct++;
    if (/[0-9]/.test(c)) digits++;
    if (/[A-Z]/.test(c)) upper++;
  }

  // Normalize rough features
  const fAvgWord = Math.min(1, avgWordLen / 10);     // 0..10+ chars
  const fPunct = Math.min(1, punct / Math.max(1, len / 6)); // typical punctuation freq
  const fDigits = Math.min(1, digits / Math.max(1, len / 12));
  const fUpper = Math.min(1, upper / Math.max(1, len / 8));

  // Weighted blend
  const raw = 0.5 * fAvgWord + 0.2 * fPunct + 0.2 * fDigits + 0.1 * fUpper;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Create contiguous chunks that are exact substrings of the given [start,end) range
 * by grouping ~N words per chunk (default 3).
 */
export function naiveChunksFromRange(
  fullText: string,
  start: number,
  end: number,
  wordsPerChunk: number = 3,
): SimpleChunk[] {
  const text = fullText;
  const total = text.length;
  const s = Math.max(0, Math.min(total, start));
  const e = Math.max(0, Math.min(total, end));
  const out: SimpleChunk[] = [];
  let i = s;

  while (i < e) {
    // skip leading whitespace
    while (i < e && /\s/.test(text[i])) i++;
    if (i >= e) break;

    const chunkStart = i;
    let words = 0;

    while (i < e && words < wordsPerChunk) {
      // advance through a "word" (sequence of non-space)
      while (i < e && !/\s/.test(text[i])) i++;
      words++;
      // include following whitespace if any, but don't count as a word
      // stopping early allows punctuation to be included in the same slice
      while (i < e && /\s/.test(text[i])) {
        // Peek if next token would exceed word budget; if so, break here
        // so we don't drag too much trailing whitespace
        const nextIsSpace = i + 1 < e ? /\s/.test(text[i + 1]) : false;
        i++;
        if (words >= wordsPerChunk && !nextIsSpace) break;
      }
    }

    const chunkEnd = i;
    const slice = text.slice(chunkStart, chunkEnd).trim();
    if (slice) {
      out.push({ text: slice, complexity: simpleComplexity(slice) });
    }
  }

  return out;
}

/**
 * Merge LLM-produced chunks with heuristic chunks to guarantee exhaustive coverage.
 * - Walks the full text from start to finish.
 * - For each LLM chunk, finds its next occurrence at/after the current pointer.
 *   - If there's a gap before that occurrence, fill with naive chunks.
 *   - Then include the LLM chunk (normalizing its complexity).
 * - After the last LLM chunk, fill the tail with naive chunks.
 */
export function mergeExhaustive(
  fullText: string,
  llmChunks: { text?: string; complexity?: number | string | null }[],
  wordsPerChunk: number = 3,
): SimpleChunk[] {
  const text = fullText || '';
  const total = text.length;
  const out: SimpleChunk[] = [];
  let ptr = 0;

  const normComplexity = (c: number | string | null | undefined): number => {
    if (typeof c === 'number' && isFinite(c)) return clamp01(c);
    if (typeof c === 'string') {
      const n = Number.parseFloat(c);
      if (isFinite(n)) return clamp01(n);
    }
    return simpleComplexity(''); // default small value
  };

  for (const item of llmChunks || []) {
    const t = (item?.text || '').trim();
    if (!t) continue;

    // Find the chunk in the remaining text at/after ptr
    const idx = text.indexOf(t, ptr);
    if (idx === -1) {
      // Not found; skip this LLM chunk (could be paraphrased or truncated)
      continue;
    }

    // Fill gap before this chunk, if any
    if (idx > ptr) {
      const gap = naiveChunksFromRange(text, ptr, idx, wordsPerChunk);
      out.push(...gap);
    }

    // Include LLM chunk
    out.push({ text: t, complexity: normComplexity(item.complexity) });

    // Advance pointer to end of this occurrence
    ptr = idx + t.length;
  }

  // Fill remaining tail
  if (ptr < total) {
    const tail = naiveChunksFromRange(text, ptr, total, wordsPerChunk);
    out.push(...tail);
  }

  return out;
}

function clamp01(x: number): number {
  if (!isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
