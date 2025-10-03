import { groq } from '@ai-sdk/groq';
import { streamObject } from 'ai';
import { processedSchema } from './schema';
import { buildProcessPrompt } from './prompt';

export const maxDuration = 300; // Allow streaming responses up to 300 seconds for long sections

type ReqBody = {
  text?: string;
};

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const inputText =
    typeof raw === 'string'
      ? raw.trim()
      : String((raw as ReqBody)?.text ?? '').trim();

  const prompt = buildProcessPrompt(inputText);

  const result = streamObject({
    model: groq('moonshotai/kimi-k2-instruct-0905'),
    schema: processedSchema,
    prompt,
  });

    return result.toTextStreamResponse({
      headers: {
        'Transfer-Encoding': 'chunked',
        Connection: 'keep-alive',
      },
    });
}
