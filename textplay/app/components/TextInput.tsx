'use client';

import { FormEvent, useState } from 'react';

interface TextInputProps {
  initialText?: string;
  onSubmit: (text: string) => void;
}

export default function TextInput({ initialText = '', onSubmit }: TextInputProps) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Please paste or type some text.');
      return;
    }
    setError(null);
    onSubmit(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-3xl space-y-4">
      <div>
        <label htmlFor="text" className="block text-sm font-medium">
          Paste text
        </label>
        <textarea
          id="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste or type text here..."
          className="mt-2 block w-full h-64 rounded-md border border-black/10 dark:border-white/15 bg-background text-foreground p-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 resize-y"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="inline-flex items-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          Start
        </button>
        <span className="text-xs text-foreground/70">
          File upload and parsing will be added later.
        </span>
      </div>
    </form>
  );
}
