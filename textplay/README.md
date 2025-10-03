# textplayer

## Core Idea
An AI augmented text reader. Allows user to read a text, using an RSVP stype player, but enhanced with generative AI.
An LLM allows for adaptive speed, indexing the text, and allowing for section summaries to make navigating the text easier.
Attitionally the individual parts of chunks can be formatted to maximise readablility.

## User experience
1. User pastes text or uploads document (eg.pdf)
2. Player opens, presenting the text RSVP style with a video player interface.
3. User can pause, play, navigate to different sections using the scrubber, or selecting a section in the index
4. User can adjust the base speed, with more settings hidden in a menu

## Features
Core (MVP)

- Upload & parsing: paste, PDF, EPUB, TXT.
- Semantic chunking with summaries & complexity scoring.
- Timeline scrubber (with hover summaries).
- RSVP player: play, pause, skip, rewind, base speed control.
- Adaptive speed based on complexity + punctuation.
- Wider text visible in paused state
- Index with jump-to navigation.
- Keyboard shortcuts (space play/pause, arrow skip).
- Mobile UI

Advanced (Post-MVP)
- Search panel with semantic search across chunks.
- Annotated highlights (important vs unimportant words).
- RSVP rewrites toggle (Rewrite text in RSVP optimised way)
- Document library (list of uploads with progress & resume states).

Future Extensions

- Translation mode
- OCR for scanned PDFs.
- User analytics
- Text to speech mode in parallel with rsvp
- Educational features, automatic cue cards or comprehension quizzes

