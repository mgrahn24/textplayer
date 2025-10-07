import { z } from 'zod';

const chunkSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe('1-5 word chunk for RSVP reading'),
  complexity: z
    .number()
    .min(0)
    .max(1)
    .describe('Relative complexity score in [0,1] for this chunk.'),
});

const sectionSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(120)
    .describe('Concise label describing the grouped sentences.'),
  chunks: z
    .array(chunkSchema)
    .min(1)
    .describe('Ordered chunks covering this section of the input text.'),
});

export const processedSchema = z.object({
  sections: z
    .array(sectionSchema)
    .default([])
    .describe('Ordered set of labelled sections for RSVP-style reading.'),
});

export type ProcessedChunk = z.infer<typeof chunkSchema>;
export type ProcessedSection = z.infer<typeof sectionSchema>;
export type Processed = z.infer<typeof processedSchema>;
