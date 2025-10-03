import { z } from 'zod';

export const processedSchema = z.object({
  chunks: z
    .array(
      z.object({
        text: z
          .string()
          .describe('1-5 word chunk for RSVP reading'),
        complexity: z
          .number()
          .min(0)
          .max(1)
          .describe('Relative complexity score in [0,1] for this chunk.'),
      }),
    )
    .default([])
    .describe('Flat sequence of chunks for RSVP-style reading.'),
});

export type Processed = z.infer<typeof processedSchema>;
