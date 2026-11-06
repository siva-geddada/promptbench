import type { ProviderConfig } from './config.js';

export interface Message {
  role: 'system' | 'user';
  content: string;
}

export interface Provider {
  /** Everything that affects the output. Used in the cache key, so it never holds the API key. */
  readonly id: string;
  complete(messages: Message[], options?: { json?: boolean }): Promise<string>;
}

export class ProviderError extends Error {}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Reasoning models may return their thinking inline. Only the answer should be graded. */
export const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/** Talks to any OpenAI-compatible server: Ollama, LM Studio, vLLM, llama.cpp, OpenAI. */
export function createProvider(config: ProviderConfig): Provider {
  const { baseUrl, model, temperature, maxTokens, reasoningEffort, timeoutMs, apiKeyEnv } = config;

  let apiKey: string | undefined;
  if (apiKeyEnv) {
    apiKey = process.env[apiKeyEnv];
    if (!apiKey) throw new ProviderError(`Environment variable ${apiKeyEnv} is not set.`);
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  async function send(body: string) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return {
    id: JSON.stringify({ baseUrl, model, temperature, maxTokens, reasoningEffort }),

    async complete(messages, options) {
      const body = JSON.stringify({
        model,
        messages,
        temperature,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(options?.json ? { response_format: { type: 'json_object' } } : {}),
      });

      let response: Response;
      try {
        response = await send(body);
        if (RETRY_STATUSES.has(response.status)) {
          await new Promise((done) => setTimeout(done, 1000));
          response = await send(body);
        }
      } catch (error) {
        const reason = (error as Error).name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : (error as Error).message;
        throw new ProviderError(`Could not reach ${url}: ${reason}`);
      }

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new ProviderError(`${model} returned ${response.status}: ${detail}`);
      }

      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content;
      const text = typeof content === 'string' ? stripThinking(content) : '';

      // A blank reply says nothing about the prompt, so it must not be graded or cached.
      if (!text) {
        throw new ProviderError(
          `${model} returned an empty reply. Reasoning models can do this. Try reasoningEffort: none, or a larger model.`,
        );
      }
      return text;
    },
  };
}
