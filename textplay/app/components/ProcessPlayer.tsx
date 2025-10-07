'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { experimental_useObject as useObject } from '@ai-sdk/react';
import { processedSchema, type Processed } from '../api/process/schema';
import { splitIntoSections, type Section } from '../lib/sections';
import { mergeExhaustive, type SimpleChunk } from '../lib/fallback';
import { 
  computeDynamicChunkDuration,
  computeChunkDurationWithLogging,
  computeScaledPunctuationDelay,
  DEFAULT_TIMING,
  type TimingConfig 
} from '../lib/timing';

type PartialChunk = { text?: string; complexity?: number | string | null };
type PartialProcessedSection = {
  summary?: string | null;
  chunks?: PartialChunk[] | null;
};

// Timing configuration can be customized via user settings
const PLAYER_TIMING: Partial<TimingConfig> = {
  baseChunksPerMinute: DEFAULT_TIMING.baseChunksPerMinute,
  complexityScaleFactor: DEFAULT_TIMING.complexityScaleFactor,
  punctuationScaleFactor: DEFAULT_TIMING.punctuationScaleFactor,
  sentenceDuration: DEFAULT_TIMING.sentenceDuration,
  clauseDuration: DEFAULT_TIMING.clauseDuration,
  defaultDuration: DEFAULT_TIMING.defaultDuration,
};


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
  const [baseSpeed, setBaseSpeed] = useState<number>(
    PLAYER_TIMING.baseChunksPerMinute ?? DEFAULT_TIMING.baseChunksPerMinute,
  );
  const [timing, setTiming] = useState<Partial<TimingConfig>>({
    baseChunksPerMinute: DEFAULT_TIMING.baseChunksPerMinute,
    // Boost defaults to make complex words noticeably slower by default:
    complexityScaleFactor: (DEFAULT_TIMING.complexityScaleFactor ?? 0.8) * 1.25,
    complexitySensitivity: Math.min(1, (DEFAULT_TIMING.complexitySensitivity ?? 0.7) + 0.2),
    complexitySpeedAttenuation: DEFAULT_TIMING.complexitySpeedAttenuation,
    complexityFloorMs: DEFAULT_TIMING.complexityFloorMs,
    punctuationScaleFactor: DEFAULT_TIMING.punctuationScaleFactor,
    sentenceDuration: DEFAULT_TIMING.sentenceDuration,
    clauseDuration: DEFAULT_TIMING.clauseDuration,
    defaultDuration: DEFAULT_TIMING.defaultDuration,
  });
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showIndicators, setShowIndicators] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [chunkIndex, setChunkIndex] = useState<number>(0);
  const [latestObject, setLatestObject] = useState<Processed | null>(null);

  const baseMsPerChunk = useMemo(
    () => 60000 / Math.max(baseSpeed || DEFAULT_TIMING.baseChunksPerMinute, 1),
    [baseSpeed],
  );

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

  const helpers = useObject<Processed>({
    api: '/api/process',
    schema: processedSchema,
  });
  const { object, submit, isLoading, error, stop } = helpers as any;
  const partialObject = (helpers as any).partialObject as any;

  useEffect(() => {
    if (object && (object as any)?.sections) {
      setLatestObject(object as unknown as Processed);
    }
  }, [object]);

  const streamingObject = partialObject ?? object ?? latestObject;

  const llmSections = useMemo<PartialProcessedSection[]>(() => {
    const source = streamingObject as Processed | null | undefined;
    if (!source || !Array.isArray(source.sections)) {
      return [];
    }
    return source.sections as unknown as PartialProcessedSection[];
  }, [streamingObject]);

  const llmChunks = useMemo<PartialChunk[]>(
    () =>
      llmSections.flatMap((section) =>
        Array.isArray(section.chunks) ? section.chunks : [],
      ),
    [llmSections],
  );

  // During streaming, prefer LLM chunks over naive chunks to avoid huge initial counts
  const displayChunks = useMemo<SimpleChunk[]>(() => {
    const source = streamingObject as Processed | null | undefined;
    const isStreaming = !!(partialObject && !object);
    
    // During streaming: only use LLM chunks, skip naive fallbacks
    if (isStreaming) {
      const validChunks: SimpleChunk[] = [];
      for (const item of llmChunks) {
        if (item?.text && (item.text as string).trim()) {
          const text = (item.text as string).trim();
          const complexity = typeof item.complexity === 'number' ? item.complexity : 0;
          // Handle string complexity values
          const normComplexity = typeof complexity === 'string' 
            ? Math.max(0, Math.min(1, parseFloat(complexity) || 0))
            : Math.max(0, Math.min(1, complexity || 0));
          validChunks.push({ text, complexity: normComplexity });
        }
      }
      return validChunks;
    }
    
    // After streaming: use mergeExhaustive for complete coverage
    return mergeExhaustive(current.text ?? '', llmChunks, 3);
  }, [streamingObject, llmChunks, current.text, partialObject, object]);

  const totalChunks = displayChunks.length;

  const safeChunkIndex =
    totalChunks === 0 ? 0 : Math.min(chunkIndex, totalChunks - 1);
  const activeChunk =
    totalChunks > 0 && safeChunkIndex < totalChunks ? displayChunks[safeChunkIndex] : null;

  // Active chunk metrics for UI
  const activeDelayMs = useMemo(
    () => (activeChunk ? Math.round(computeDynamicChunkDuration(activeChunk, baseSpeed, timing)) : 0),
    [activeChunk, baseSpeed, timing],
  );
  const activeComplexity = useMemo(() => {
    if (!activeChunk) return 0;
    const provided = Number.isFinite(activeChunk.complexity)
      ? Math.max(0, Math.min(1, Number(activeChunk.complexity)))
      : 0;
    const words = (activeChunk.text || '').trim().split(/\s+/).filter(Boolean);
    const avgWordLen = words.length ? words.reduce((a, w) => a + w.length, 0) / words.length : 0;
    const lexical = Math.max(0, Math.min(1, (avgWordLen - 4) / 6));
    return Math.max(provided, lexical);
  }, [activeChunk]);

  const statusLabel = useMemo(() => {
    const source = streamingObject as Processed | null | undefined;
    const isStreaming = !!(isLoading && object === null);
    const hasChunks = displayChunks.length > 0;
    
    if (isPlaying) return 'Playing';
    if (isLoading && isStreaming && hasChunks) return 'Streaming';
    if (isLoading && !source) return 'Loading...';
    if (isLoading && isStreaming) return 'Streaming...';
    if (isLoading) return 'Processing...';
    return 'Paused';
  }, [isPlaying, isLoading, streamingObject, displayChunks.length, object]);

  // Separate effect to handle chunk index bounds checking - this should not interrupt playback
  useEffect(() => {
    if (totalChunks === 0) {
      if (chunkIndex !== 0) setChunkIndex(0);
      setIsPlaying(false);
      return;
    }
    if (chunkIndex >= totalChunks) {
      setChunkIndex(totalChunks - 1);
      setIsPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalChunks]);

  // Auto-submit current section for processing when it changes
  useEffect(() => {
    const payload = current.text?.trim() ?? '';
    const key = `${currentIndex}:${payload.length}:${tokenLimit}`;
    if (payload && key !== lastSubmittedKey) {
      lastSubmittedKey = key;
      setLatestObject(null);
      setChunkIndex(0);
      setIsPlaying(false);
      submit(payload);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, current.text, tokenLimit]);

  // Use a ref to track the current chunks, so the effect doesn't restart when chunks change
  const currentChunksRef = useRef<SimpleChunk[]>([]);
  useEffect(() => {
    currentChunksRef.current = displayChunks;
  }, [displayChunks]);

  // Log all chunk durations when streaming completes
  useEffect(() => {
    // Only log when stream transitions from streaming to complete
    if (!isLoading && previousLoadingStatusRef.current === true) {
      if (displayChunks.length > 0 && object) {
        console.log('✅ Streaming completed! Logging timings for all chunks:', { 
          totalChunks: displayChunks.length,
          settings: {
            baseSpeed,
            baseMsPerChunk: `${baseMsPerChunk}ms`,
            complexityScaleFactor: timing.complexityScaleFactor,
            complexitySensitivity: timing.complexitySensitivity,
            punctuationScaleFactor: timing.punctuationScaleFactor,
          }
        });
        
        displayChunks.forEach((chunk, index) => {
          const duration = computeChunkDurationWithLogging(chunk, baseSpeed, timing);
          console.log(`Chunk ${index + 1} of ${displayChunks.length}: "${chunk.text}" (${duration}ms)`);
        });
      }
    }
    // Track previous loading status for change detection
    previousLoadingStatusRef.current = isLoading;
  }, [isLoading, object, displayChunks, baseMsPerChunk, baseSpeed]);

  const previousLoadingStatusRef = useRef<boolean>(isLoading);

  // Simplified playback effect - just advance when chunk index changes or play starts
  useEffect(() => {
    if (!isPlaying) return;

    const chunks = currentChunksRef.current;
    const totalChunks = chunks.length;
    
    if (totalChunks === 0) {
      setIsPlaying(false);
      return;
    }

    // Clamp current index to bounds
    const currentIndex = Math.min(chunkIndex, Math.max(0, totalChunks - 1));
    
    if (currentIndex >= totalChunks) {
      // Wrap to beginning for continuous play
      setChunkIndex(0);
      return;
    }
    
    const activeChunk = chunks[currentIndex];
    if (!activeChunk) {
      setIsPlaying(false);
      return;
    }

  const delay = computeDynamicChunkDuration(activeChunk, baseSpeed, timing);
    const timeout = window.setTimeout(() => {
      // Advance to next chunk
      setChunkIndex((prev) => {
        const nextIndex = prev + 1;
        return nextIndex >= totalChunks ? 0 : nextIndex; // Wrap to start
      });
    }, delay);
    
    return () => window.clearTimeout(timeout);
  }, [
    isPlaying,
    chunkIndex,
    baseSpeed,
    timing.complexityScaleFactor,
    timing.complexitySensitivity,
    timing.complexitySpeedAttenuation,
    timing.complexityFloorMs,
    timing.punctuationScaleFactor,
    timing.sentenceDuration,
    timing.clauseDuration,
    timing.defaultDuration,
  ]);

  const handlePlay = () => {
    if (totalChunks === 0) return;
    // Always reset to beginning when starting play
    setChunkIndex(0);
    setIsPlaying(true);
  };

  const handlePause = () => setIsPlaying(false);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex + 1 < sections.length;

  return (
    <div className="w-full max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold">Processed View</h2>
          <div className="text-xs text-foreground/70 mt-0.5">
            Section {currentIndex + 1} of {sections.length} - ~
            {current.approxTokens.toLocaleString()} tokens
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setLatestObject(null);
              setChunkIndex(0);
              setIsPlaying(false);
              submit(current.text ?? '');
            }}
            className="inline-flex items-center rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            {isLoading ? 'Processing...' : 'Re-process'}
          </button>
          <button
            type="button"
            onClick={() => {
              stop?.();
              setIsPlaying(false);
              setChunkIndex(0);
              setLatestObject(null);
              onReset();
            }}
            className="inline-flex items-center rounded-md border border-black/10 dark:border-white/15 bg-background text-foreground px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
          >
            Edit text
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="inline-flex items-center rounded-md border border-black/10 dark:border-white/15 bg-background text-foreground px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
          >
            Settings
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
              setIsPlaying(false);
              setChunkIndex(0);
              setCurrentIndex((i) => Math.max(0, i - 1));
            }}
            className="inline-flex items-center rounded-md border border-black/10 dark:border-white/15 bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-50 hover:bg-foreground/5"
          >
            {'< Prev'}
          </button>
          <select
            value={currentIndex}
            onChange={(e) => {
              stop?.();
              setIsPlaying(false);
              setChunkIndex(0);
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
              setIsPlaying(false);
              setChunkIndex(0);
              setCurrentIndex((i) => Math.min(sections.length - 1, i + 1));
            }}
            className="inline-flex items-center rounded-md border border-black/10 dark:border-white/15 bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-50 hover:bg-foreground/5"
          >
            {'Next >'}
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
                setLatestObject(null);
                setChunkIndex(0);
                setIsPlaying(false);
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

      {!streamingObject && isLoading && (
        <div className="rounded-md border border-black/10 dark:border-white/15 bg-background p-4 text-sm">
          Processing current section... streaming structured output.
        </div>
      )}

      {/* Current section preview */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Current Section Preview</h3>
          {isPlaying && (
            <span className="text-xs text-foreground/60">Hidden during playback</span>
          )}
        </div>
        {!isPlaying ? (
          <div className="rounded-md border border-black/10 dark:border-white/15 bg-background p-3 text-sm max-h-48 overflow-auto whitespace-pre-wrap">
            {current.text}
          </div>
        ) : (
          <div className="rounded-md border border-black/10 dark:border-white/15 bg-background p-3 text-sm text-foreground/60">
            Preview hidden while the player is running.
          </div>
        )}
      </section>

      {/* RSVP Player */}
      <section className="space-y-3">
        <h3 className="font-medium">RSVP Player</h3>
        <div className="rounded-md border border-black/10 dark:border-white/15 bg-background p-4 space-y-2 shadow-sm">
          <div className="flex items-center justify-center text-5xl md:text-6xl font-semibold tracking-wide min-h-[120px] md:min-h-[160px]">
            {activeChunk?.text ?? (isLoading ? 'Processing...' : 'Waiting for chunks...')}
          </div>
          {/* Complexity + Delay indicators */}
          {showIndicators && (
            <div className="flex items-center justify-between text-xs text-foreground/60">
              <div className="flex items-center gap-2">
                <span>Complexity: {(activeComplexity * 100).toFixed(0)}%</span>
                <div className="w-28 h-2 bg-foreground/10 rounded">
                  <div
                    className="h-2 bg-foreground/60 rounded"
                    style={{ width: `${Math.max(4, activeComplexity * 100)}%` }}
                  />
                </div>
              </div>
              <span>Delay: {activeDelayMs} ms</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-foreground/60">
            <span>
              Chunk {totalChunks === 0 ? 0 : Math.min(safeChunkIndex + 1, totalChunks)} of {totalChunks}
            </span>
            <span>{statusLabel}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePlay}
            disabled={totalChunks === 0}
            className="inline-flex items-center rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-50 hover:opacity-90"
          >
            Play
          </button>
          <button
            type="button"
            onClick={handlePause}
            disabled={!isPlaying}
            className="inline-flex items-center rounded-md border border-black/10 dark:border-white/15 bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-50 hover:bg-foreground/5"
          >
            Pause
          </button>
          <div className="flex items-center gap-2">
            <label htmlFor="base-speed" className="text-xs text-foreground/70">
              Base speed (chunks/min)
            </label>
            <input
              id="base-speed"
              type="number"
              min={60}
              step={10}
              value={baseSpeed}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value > 0) {
                  setBaseSpeed(Math.floor(value));
                }
              }}
              className="w-24 rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </section>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowSettings(false)}
          />
          <div className="relative z-10 w-full max-w-lg rounded-md border border-black/10 dark:border-white/15 bg-background p-4 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Playback Settings</h4>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-sm text-foreground/70 hover:text-foreground"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Base speed */}
              <div className="flex flex-col gap-1">
                <label htmlFor="modal-base-speed" className="text-xs text-foreground/70">Base speed (chunks/min)</label>
                <input
                  id="modal-base-speed"
                  type="number"
                  min={60}
                  step={10}
                  value={baseSpeed}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value) && value > 0) {
                      setBaseSpeed(Math.floor(value));
                    }
                  }}
                  className="rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
                />
              </div>

              {/* Complexity sensitivity */}
              <div className="flex flex-col gap-1">
                <label htmlFor="complexity-sensitivity" className="text-xs text-foreground/70">Complexity sensitivity (0-1)</label>
                <input
                  id="complexity-sensitivity"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={timing.complexitySensitivity ?? DEFAULT_TIMING.complexitySensitivity}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      setTiming(prev => ({ ...prev, complexitySensitivity: Math.max(0, Math.min(1, v)) }));
                    }
                  }}
                  className="rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
                />
              </div>

              {/* Complexity scale factor */}
              <div className="flex flex-col gap-1">
                <label htmlFor="complexity-scale" className="text-xs text-foreground/70">Complexity scale factor</label>
                <input
                  id="complexity-scale"
                  type="number"
                  min={0}
                  max={2}
                  step={0.05}
                  value={timing.complexityScaleFactor ?? DEFAULT_TIMING.complexityScaleFactor}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      setTiming(prev => ({ ...prev, complexityScaleFactor: Math.max(0, v) }));
                    }
                  }}
                  className="rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
                />
              </div>

              {/* Complexity speed attenuation */}
              <div className="flex flex-col gap-1">
                <label htmlFor="complexity-attenuation" className="text-xs text-foreground/70">Complexity speed attenuation (0-2)</label>
                <input
                  id="complexity-attenuation"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={timing.complexitySpeedAttenuation ?? DEFAULT_TIMING.complexitySpeedAttenuation}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      setTiming(prev => ({ ...prev, complexitySpeedAttenuation: Math.max(0, v) }));
                    }
                  }}
                  className="rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
                />
              </div>

              {/* Complexity floor (ms) */}
              <div className="flex flex-col gap-1">
                <label htmlFor="complexity-floor" className="text-xs text-foreground/70">Complexity floor (ms)</label>
                <input
                  id="complexity-floor"
                  type="number"
                  min={0}
                  step={10}
                  value={timing.complexityFloorMs ?? DEFAULT_TIMING.complexityFloorMs}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      setTiming(prev => ({ ...prev, complexityFloorMs: Math.max(0, Math.floor(v)) }));
                    }
                  }}
                  className="rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
                />
              </div>

              {/* Punctuation scale factor */}
              <div className="flex flex-col gap-1">
                <label htmlFor="punctuation-scale" className="text-xs text-foreground/70">Punctuation scale factor</label>
                <input
                  id="punctuation-scale"
                  type="number"
                  min={0}
                  max={2}
                  step={0.05}
                  value={timing.punctuationScaleFactor ?? DEFAULT_TIMING.punctuationScaleFactor}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      setTiming(prev => ({ ...prev, punctuationScaleFactor: Math.max(0, v) }));
                    }
                  }}
                  className="rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
                />
              </div>

              {/* Sentence delay */}
              <div className="flex flex-col gap-1">
                <label htmlFor="sentence-delay" className="text-xs text-foreground/70">Sentence delay (ms)</label>
                <input
                  id="sentence-delay"
                  type="number"
                  min={0}
                  step={10}
                  value={timing.sentenceDuration ?? DEFAULT_TIMING.sentenceDuration}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      setTiming(prev => ({ ...prev, sentenceDuration: Math.max(0, Math.floor(v)) }));
                    }
                  }}
                  className="rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
                />
              </div>

              {/* Clause delay */}
              <div className="flex flex-col gap-1">
                <label htmlFor="clause-delay" className="text-xs text-foreground/70">Clause delay (ms)</label>
                <input
                  id="clause-delay"
                  type="number"
                  min={0}
                  step={10}
                  value={timing.clauseDuration ?? DEFAULT_TIMING.clauseDuration}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      setTiming(prev => ({ ...prev, clauseDuration: Math.max(0, Math.floor(v)) }));
                    }
                  }}
                  className="rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
                />
              </div>

              {/* Default delay */}
              <div className="flex flex-col gap-1">
                <label htmlFor="default-delay" className="text-xs text-foreground/70">Default delay (ms)</label>
                <input
                  id="default-delay"
                  type="number"
                  min={0}
                  step={10}
                  value={timing.defaultDuration ?? DEFAULT_TIMING.defaultDuration}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      setTiming(prev => ({ ...prev, defaultDuration: Math.max(0, Math.floor(v)) }));
                    }
                  }}
                  className="rounded-md border border-black/10 dark:border-white/15 bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="show-indicators"
                type="checkbox"
                className="h-4 w-4"
                checked={showIndicators}
                onChange={(e) => setShowIndicators(e.target.checked)}
              />
              <label htmlFor="show-indicators" className="text-sm">
                Show complexity/delay indicators
              </label>
            </div>
            <div className="text-xs text-foreground/60">
              Changes apply immediately and affect ongoing playback.
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
