import { existsSync, writeFileSync } from 'node:fs';

export const SAMPLE = `# PromptBench config. Docs: see the README.
provider:
  baseUrl: http://localhost:11434/v1 # any OpenAI-compatible server
  model: qwen3:8b                    # change this to a model you have
  # reasoningEffort: none            # much faster on reasoning models
  # apiKeyEnv: OPENAI_API_KEY        # the variable's name, never the key itself

threshold: 0.9 # --ci fails below this pass rate

prompts:
  v1: "Classify this support message as billing, bug or other. Message: {{message}}"
  v2:
    system: >-
      You classify support messages. Reply with only JSON in this form:
      {"category": "billing" | "bug" | "other"}
    user: "{{message}}"

cases:
  - name: double charge
    vars:
      message: I was charged twice this month.
    assert:
      - type: is-json
      - type: json-field
        path: category
        equals: billing

  - name: crash report
    vars:
      message: The app crashes when I open settings.
    assert:
      - type: json-field
        path: category
        equals: bug

  - name: polite refusal
    vars:
      message: What is the weather today?
    assert:
      - type: json-field
        path: category
        equals: other
      - type: max-chars
        value: 200
`;

export function init(path: string) {
  if (existsSync(path)) throw new Error(`${path} already exists, so it was left unchanged.`);
  writeFileSync(path, SAMPLE);
}
