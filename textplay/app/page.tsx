'use client';

import { useState } from 'react';
import TextInput from './components/TextInput';
import ProcessPlayer from './components/ProcessPlayer';

export default function Home() {
  const [submittedText, setSubmittedText] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex flex-col items-center p-6 sm:p-10">

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


    </div>
  );
}
