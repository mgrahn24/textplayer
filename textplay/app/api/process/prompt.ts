export function buildProcessPrompt(inputText: string) {
  // Keep the prompt deterministic and schema-aligned.
  return `
You are a helpful assistant that splits the provided text into small RSVP-style chunks and assigns a relative complexity score to each chunk.

Output requirements:
- Follow the exact JSON schema provided by the tool caller.
- Provide ONLY:
  - chunks: an array where each item has:
    - text: a 1–5 word chunk copied verbatim from the input (preserve casing and punctuation)
    - complexity: a number in [0,1] indicating relative reading difficulty
      - 0.0 = trivial/simple; 1.0 = very complex
- Do not add additional fields or commentary beyond the schema.

Exhaustive coverage (critical):
- Cover the ENTIRE input text from first character to last; do not stop early.
- Continue emitting chunks until all of the input text has been chunked.
- Do not skip, summarize, or paraphrase any portion of the input.
- The concatenation of chunk.text values in order must reconstruct the input text (allowing only trivial whitespace differences at chunk boundaries).

Chunking guidance:
- Keep chunks short (1–5 words). Prefer natural breaks (spaces, punctuation).
- Do not rewrite or paraphrase; text must be an exact substring of the input.
- You may include punctuation if it naturally ends a chunk (e.g., "end.").
- Complexity should consider factors like length, rare words, numbers/symbols, clause density, and punctuation.
- Normalize complexity across the document to the [0,1] range.

Input text:
${inputText}
`.trim();
}
