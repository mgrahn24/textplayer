'use client';

import { useEffect, useMemo, useState } from 'react';
import { experimental_useObject as useObject } from '@ai-sdk/react';
import { processedSchema, type Processed } from '../api/process/schema';
import { splitIntoSections, type Section } from '../lib/sections';
import { mergeExhaustive } from '../lib/fallback';

type PartialChunk = { text?: string; complexity?: number | string | null };

function ChunkItem({ text, complexity }: PartialChunk) {
  let value: number | undefined;
  if (typeof complexity === 'number') value = complexity;
  else if (complexity != null) {
    const n = Number.parseFloat(String(complexity));
    if (Number.isFinite(n)) value = n;
  }
  const display = value !== undefined ? value.toFixed(2) : '…';
  return (
    <li className="rounded-md border border-black/10 dark:border-white/15 bg-background p-3 shadow-sm flex items-center justify-between">
      <span className="font-medium">{text ?? ''}</span>
      <span className="text-xs text-foreground/60">{display}</span>
    </li>
  );
}

// Guard duplicate submits in React Strict Mode dev
let lastSubmittedKey: string | null = null;

interface ProcessPlayerProps {
  text: string;
  onReset: () => void;
}

function parseDefaultLimit(): number {
  const env = process.env.NEXT_PUBLIC_SECTION_TOKEN_LIMIT;
  const n = typeof env === 'string' ? Number(env) : Number(env ?? NaN);
  // Default to 8k tokens per section (safer for most models) if env not set/invalid
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8_000;
}

export default function ProcessPlayer({ text, onReset }: ProcessPlayerProps) {
  // Configurable section token limit (approximate)
  const [tokenLimit, setTokenLimit] = useState<number>(parseDefaultLimit());

  // Split the submitted text into coarse sections
  const sections: Section[] = useMemo(
    () => splitIntoSections(text, { tokensPerSection: tokenLimit }),
    [text, tokenLimit],
  );

  const [currentIndex, setCurrentIndex] = useState<number>(0);

  // Clamp/reset index if sections change
  useEffect(() => {
    if (currentIndex >= sections.length) setCurrentIndex(0);
  }, [sections.length, currentIndex]);

  const current = sections[currentIndex] ?? {
    id: 'section-0',
    index: 0,
    start: 0,
    end: 0,
    text: '',
    approxTokens: 0,
    title: 'Section 1',
  };

  const { object, submit, isLoading, error, stop } = useObject({
    api: '/api/process',
    schema: processedSchema,
  });
  const chunks = (object?.chunks ?? []) as Processed['chunks'];
  const displayChunks = useMemo(
    () => mergeExhaustive(current.text ?? '', chunks as any, 3),
    [current.text, chunks],
  );

  // Auto-submit current section for processing when it changes
  useEffect(() => {
    const payload = current.text?.trim() ?? '';
    const key = `${currentIndex}:${payload.length}:${tokenLimit}`;
    if (payload && key !== lastSubmittedKey) {
      lastSubmittedKey = key;
      submit(payload);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, current.text, tokenLimit]);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex + 1 < sections.length;

  return (
    <div className="w-full max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold">Processed View</h2>
          <div className="text-xs text-foreground/70 mt-0.5">
            Section {currentIndex + 1} of {sections.length} — ~{current.approxTokens.toLocaleString()} tokens
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => submit(current.text ?? '')}
            className="inline-flex items-center rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            {isLoading ? 'Processing…' : 'Re-process'}
          </button>
          <button
            type="button"
            onClick={() => {
              stop?.();
              onReset();
            }}
            className="inline-flex items-center rounded-md border border-black/10 dark:border-white/15 bg-background text-foreground px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
          >
            Edit text
          </button>
        </div>
      </div>

      {/* Section controls */}
      <div className="rounded-md border border-black/10 dark:border-white/15 bg-background p-3 shadow-sm flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => {
              stop?.();
              setCurrentIndex((i) => Math.max(0, i - 1));
            }}
            className="inline-flex items-center rounded-md border border-black/10 dark:border-white/15 bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-50 hover:bg-foreground/5"
          >
            ◀ Prev
          </button>
          <select
            value={currentIndex}
            onChange={(e) => {
              stop?.();
              setCurrentIndex(Number(e.target.value));
            }}
            className="rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
          >
            {sections.map((s, i) => (
              <option key={s.id} value={i}>
                {s.title} ({s.approxTokens.toLocaleString()} tok)
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => {
              stop?.();
              setCurrentIndex((i) => Math.min(sections.length - 1, i + 1));
            }}
            className="inline-flex items-center rounded-md border border-black/10 dark:border-white/15 bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-50 hover:bg-foreground/5"
          >
            Next ▶
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="token-limit" className="text-xs text-foreground/70">
            Tokens/section
          </label>
          <input
            id="token-limit"
            type="number"
            min={1000}
            step={1000}
            value={tokenLimit}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) {
                // Force a new submit by invalidating lastSubmittedKey
                lastSubmittedKey = null;
                setTokenLimit(Math.floor(v));
              }
            }}
            className="w-28 rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 text-red-800 p-3 text-sm">
          {String(error)}
        </div>
      )}

      {!object && isLoading && (
        <div className="rounded-md border border-black/10 dark:border-white/15 bg-background p-4 text-sm">
          Processing current section… streaming structured output.
        </div>
      )}

      {/* Current section preview */}
      <section className="space-y-2">
        <h3 className="font-medium">Current Section Preview</h3>
        <div className="rounded-md border border-black/10 dark:border-white/15 bg-background p-3 text-sm max-h-48 overflow-auto whitespace-pre-wrap">
          {current.text}
        </div>
      </section>

      {/* Processed chunks for current section */}
      {object && (
        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="font-medium">Chunks</h3>
            <ul className="space-y-3">
              {displayChunks.map((chunk, idx) => (
                <ChunkItem key={idx} {...chunk} />
              ))}
            </ul>
            {isLoading && (
              <p className="text-xs text-foreground/60">
                Streaming… {displayChunks.length} chunks loaded (exhaustive)
              </p>
            )}
          </section>
      </div>
      )}
    </div>
  );
}
