'use client';

interface TextPlayerProps {
  text: string;
  onReset: () => void;
}

export default function TextPlayer({ text, onReset }: TextPlayerProps) {
  return (
    <div className="w-full max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Player</h2>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
        >
          Edit text
        </button>
      </div>

      <div className="rounded-md border border-black/10 dark:border-white/15 bg-background text-foreground p-4 shadow-sm">
        <div className="prose max-w-none whitespace-pre-wrap">
          {text}
        </div>
      </div>
    </div>
  );
}
