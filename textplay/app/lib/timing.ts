export type TimingConfig = {
  baseChunksPerMinute: number;
  complexityScaleFactor: number;
  complexitySensitivity: number; // How sensitive we are to complexity (0-1)
  complexitySpeedAttenuation: number; // 0=no attenuation; higher values reduce complexity effect at high speeds
  complexityFloorMs: number; // extra ms added proportional to complexity (unaffected by base speed)
  punctuationScaleFactor: number;
  sentenceDuration: number;
  clauseDuration: number;
  defaultDuration: number;
};

export const DEFAULT_TIMING: TimingConfig = {
  baseChunksPerMinute: 320,  // This is the reference speed
  complexityScaleFactor: 1.0,  // Slightly stronger impact of complexity by default
  complexitySensitivity: 0.85,  // Higher sensitivity -> longer pauses for complex words
  complexitySpeedAttenuation: 0.0, // keep complexity effect visible at high speeds by default
  complexityFloorMs: 180, // more floor time so complex words get extra pause even at high speeds
  punctuationScaleFactor: 0.6,  // How much punctuation scales with speed
  sentenceDuration: 340,
  clauseDuration: 180,
  defaultDuration: 80,
};

/**
 * Backward compatibility: compute punctuation delay without speed scaling
 */
export function computePunctuationDelay(
  text?: string | null,
  customTimings?: Partial<Omit<TimingConfig, 'baseChunksPerMinute'>>
): number {
  return computeScaledPunctuationDelay(text, DEFAULT_TIMING.baseChunksPerMinute, DEFAULT_TIMING.baseChunksPerMinute, 0, customTimings);
}

/**
 * Compute pause duration based on ending punctuation, scaled by base speed
 */
export function computeScaledPunctuationDelay(
  text?: string | null,
  baseSpeed: number = DEFAULT_TIMING.baseChunksPerMinute,
  baseSpeedReference: number = DEFAULT_TIMING.baseChunksPerMinute,
  scaleFactor: number = DEFAULT_TIMING.punctuationScaleFactor,
  customTimings?: Partial<Omit<TimingConfig, 'baseChunksPerMinute'>>
): number {
  const value = (text ?? '').trim();
  if (!value) return 0;

  const timing = { ...DEFAULT_TIMING, ...customTimings };
  const last = value[value.length - 1];

  // Determin base punctuation duration
  let baseDelay = 0;
  if (/[.!?]/.test(last)) {
    baseDelay = timing.sentenceDuration;
  } else if (/[,;:]/.test(last)) {
    baseDelay = timing.clauseDuration;
  } else if (/-/.test(last)) {
    baseDelay = timing.defaultDuration;
  }

  // Scale based on speed ratio to make all components scale together
  const speedRatio = baseSpeedReference / baseSpeed;
  return baseDelay * Math.pow(speedRatio, scaleFactor);
}

/**
 * Compute dynamically computed timing based on current settings.
 * All components scale proportionally to maintain relative timing.
 */
export function computeDynamicChunkDuration(
  chunk: { text: string; complexity?: number },
  baseSpeed: number,  // chunks per minute
  baseSettings: Partial<TimingConfig> = {}
): number {
  const timing = { ...DEFAULT_TIMING, ...baseSettings };
  
  // Base timing - dynamically calculated instead of pre-calculated
  const baseChunksPerSecond = baseSpeed / 60;
  const baseMsPerChunk = 1000 / baseChunksPerSecond;

  // Complexity delay using effective complexity (provided or lexical) with strong sensitivity
  const provided = Number.isFinite(chunk.complexity)
    ? Math.max(0, Math.min(1, chunk.complexity as number))
    : 0;

  // Derive a lexical difficulty from average word length (4-10 chars -> 0..1)
  const words = (chunk.text || '').trim().split(/\s+/).filter(Boolean);
  const avgWordLen = words.length ? words.reduce((a, w) => a + w.length, 0) / words.length : 0;
  const lexical = Math.max(0, Math.min(1, (avgWordLen - 4) / 6));

  // Effective complexity: the greater of provided complexity and lexical difficulty
  const effective = Math.max(provided, lexical);

  const sensitivity = (timing.complexitySensitivity ?? DEFAULT_TIMING.complexitySensitivity ?? 0.7);
  const exponent = 1 + sensitivity * 2; // 1..3 (higher = much slower on complex chunks)

  // Base complexity delay relative to baseMsPerChunk with configurable scale
  const complexityDelay = Math.pow(effective, exponent) * (baseMsPerChunk * (timing.complexityScaleFactor ?? 1));

  // Punctuation delay dynamically computed and scaled with base speed
  const punctuationDelay = computeScaledPunctuationDelay(
    chunk.text, 
    baseSpeed, 
    timing.baseChunksPerMinute,
    timing.punctuationScaleFactor,
    timing
  );

  // Scale complexity delay with speed (attenuation usually 0..1). Lower attenuation keeps effect visible at high speeds.
  const refCpm = timing.baseChunksPerMinute ?? DEFAULT_TIMING.baseChunksPerMinute ?? 320;
  const speedRatio = refCpm / Math.max(1, baseSpeed);
  const attenuation = Math.max(0, timing.complexitySpeedAttenuation ?? DEFAULT_TIMING.complexitySpeedAttenuation ?? 0);
  const complexityDelayScaled = complexityDelay * Math.pow(speedRatio, attenuation);

  // Add a floor component that grows with complexity but is unaffected by base speed
  const floor = (timing.complexityFloorMs ?? DEFAULT_TIMING.complexityFloorMs ?? 0) * effective;

  // Note: computeScaledPunctuationDelay already applies speed scaling for punctuation
  const punctuationDelayScaled = punctuationDelay;

  return baseMsPerChunk + complexityDelayScaled + floor + punctuationDelayScaled;
}

/**
 * Compute chunk duration with detailed logging for debugging
 */
export function computeChunkDurationWithLogging(
  chunk: { text: string; complexity?: number },
  baseSpeed: number,
  baseSettings: Partial<TimingConfig> = {}
): number {
  // Recompute components to log accurate breakdown with current settings
  const timing = { ...DEFAULT_TIMING, ...baseSettings };
  const baseChunksPerSecond = baseSpeed / 60;
  const baseMsPerChunk = 1000 / Math.max(0.001, baseChunksPerSecond);

  // Effective complexity with lexical component
  const provided = Number.isFinite(chunk.complexity)
    ? Math.max(0, Math.min(1, chunk.complexity as number))
    : 0;
  const words = (chunk.text || '').trim().split(/\s+/).filter(Boolean);
  const avgWordLen = words.length ? words.reduce((a, w) => a + w.length, 0) / words.length : 0;
  const lexical = Math.max(0, Math.min(1, (avgWordLen - 4) / 6));
  const effective = Math.max(provided, lexical);

  const sensitivity = timing.complexitySensitivity ?? DEFAULT_TIMING.complexitySensitivity ?? 0.7;
  const exponent = 1 + sensitivity * 2;

  const rawComplexityDelay = Math.pow(effective, exponent) * (baseMsPerChunk * (timing.complexityScaleFactor ?? 1));

  const refCpm = timing.baseChunksPerMinute ?? DEFAULT_TIMING.baseChunksPerMinute;
  const speedRatio = refCpm / Math.max(1, baseSpeed);
  const attenuation = Math.max(0, timing.complexitySpeedAttenuation ?? DEFAULT_TIMING.complexitySpeedAttenuation ?? 0);
  const complexityDelayScaled = rawComplexityDelay * Math.pow(speedRatio, attenuation);
  const floor = (timing.complexityFloorMs ?? DEFAULT_TIMING.complexityFloorMs ?? 0) * effective;

  const punctuationDelay = computeScaledPunctuationDelay(
    chunk.text,
    baseSpeed,
    timing.baseChunksPerMinute,
    timing.punctuationScaleFactor,
    timing
  );

  const total = baseMsPerChunk + complexityDelayScaled + floor + punctuationDelay;

  console.log(`Chunk timing breakdown:`, {
    text: chunk.text,
    // Log both provided and lexical to help tuning
    providedComplexity: provided,
    lexicalComplexity: Number.isFinite(avgWordLen) ? Number(lexical.toFixed(2)) : 0,
    effectiveComplexity: Number(effective.toFixed(2)),
    sensitivity,
    exponent,
    attenuation,
    baseSpeed,
    baseMsPerChunk: `${Math.round(baseMsPerChunk)}ms`,
    complexityDelay: `${Math.round(complexityDelayScaled)}ms`,
    complexityFloorMs: `${Math.round(floor)}ms`,
    punctuationDelay: `${Math.round(punctuationDelay)}ms`,
    totalDuration: `${Math.round(total)}ms`
  });

  return total;
}
