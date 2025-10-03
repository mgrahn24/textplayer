'use client';

import { useState } from 'react';
import TextInput from './components/TextInput';
import ProcessPlayer from './components/ProcessPlayer';

export default function Home() {
  const [submittedText, setSubmittedText] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex flex-col items-center p-6 sm:p-10">
      <header className="w-full max-w-4xl mb-8">
        <h1 className="text-2xl font-bold">textplayer</h1>
        <p className="text-sm text-foreground/70">Paste text, then view it in the player.</p>
      </header>

      <main className="w-full flex-1 flex flex-col items-center">
        {submittedText ? (
          <ProcessPlayer
            text={submittedText}
            onReset={() => setSubmittedText(null)}
          />
        ) : (
          <TextInput onSubmit={setSubmittedText} />
        )}
      </main>

      <footer className="w-full max-w-4xl mt-12 text-xs text-foreground/60">
        MVP scaffold — features to be added iteratively.
      </footer>
    </div>
  );
}
