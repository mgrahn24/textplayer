export function buildProcessPrompt(inputText: string) {
  // Keep the prompt deterministic and schema-aligned.
  return `
You are a helpful assistant that splits the provided text into RSVP-friendly chunks, assigning a relative complexity score, and grouping the chunks into short labelled sections.

Output requirements:
- Follow the exact JSON schema provided by the tool caller.
- Provide ONLY:
  - sections: an array where each item has:
    - summary: a concise 2-6 word label that describes the grouped sentences
    - chunks: an array of objects, each with:
      - text: a 1-5 word chunk copied verbatim from the input (preserve casing and punctuation)
      - complexity: a number in [0,1] indicating relative reading difficulty
        - 0.0 = trivial/simple; 1.0 = very complex
- Do not add additional fields or commentary beyond the schema.

Exhaustive coverage (critical):
- Cover the ENTIRE input text from first character to last; do not stop early.
- Sections must appear in reading order and together must span the full input.
- Continue emitting chunks until all of the input text has been chunked.
- Within each section, the concatenation of chunk.text values in order must reconstruct that portion of the input, and across all sections must reconstruct the full input (allowing only trivial whitespace differences at chunk boundaries).

Section & chunk guidance:
- Group neighbouring sentences or clauses that naturally belong together (e.g., same topic, action, or idea). Avoid single-chunk sections unless the text is extremely short.
- Summaries should be immediately scannable navigation labels, not full sentences. Keep them <= 8 words.
- Default to single-word chunks for a steady RSVP cadence.
- Only keep multi-word chunks when the words form an inseparable unit (e.g., named entities like "White House", fixed spans such as "1-3 days", "$1.7 trillion", dates, or measurements), and keep those phrases within 2-5 words.
- Do not rewrite or paraphrase; text must be an exact substring of the input.
- You may include punctuation if it naturally ends a chunk (e.g., "end.").
- Complexity should consider factors like length, rare words, numbers/symbols, clause density, and punctuation.
- Normalize complexity across the document to the [0,1] range.

Input text:
${inputText}
`.trim();
}
