import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type ProviderConfig } from '../src/config.js';
import { createProvider, ProviderError, stripThinking } from '../src/provider.js';
import { ciExitCode, compareRuns, percent, sideBySide, wrap } from '../src/report.js';
import type { CaseResult, PromptRun } from '../src/runner.js';

const dir = mkdtempSync(join(tmpdir(), 'promptbench-'));

function write(name: string, content: string) {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

const VALID = `
provider: { model: test }
prompts:
  v1: "Say {{x}}"
cases:
  - name: one
    vars: { x: hi }
    assert:
      - { type: contains, value: hi }
`;

describe('loadConfig', () => {
  it('reads YAML and applies defaults', () => {
    const config = loadConfig(write('a.yaml', VALID));

    expect(config.provider).toMatchObject({ baseUrl: 'http://localhost:11434/v1', temperature: 0 });
    expect(config.judge).toEqual(config.provider);
    expect(config.threshold).toBe(1);
    expect(config.prompts.v1).toEqual({ user: 'Say {{x}}' });
  });

  it('reads JSON, and cases and prompts from other files', () => {
    write('cases.json', JSON.stringify([{ name: 'c', assert: [{ type: 'is-json' }] }]));
    write('prompt.txt', 'From a file');
    const config = loadConfig(
      write(
        'b.json',
        JSON.stringify({ provider: { model: 'm' }, prompts: { p: { file: 'prompt.txt' } }, cases: 'cases.json' }),
      ),
    );

    expect(config.cases[0]?.name).toBe('c');
    expect(config.prompts.p?.user).toBe('From a file');
  });

  it.each([
    ['an unknown assertion', VALID.replace('contains', 'containz')],
    ['a mistyped key', VALID.replace('prompts:', 'promps:')],
    ['a broken regex', VALID.replace('{ type: contains, value: hi }', '{ type: regex, value: "(" }')],
    ['a case with no assertions', VALID.replace('assert:\n      - { type: contains, value: hi }', 'assert: []')],
  ])('rejects %s', (_, content) => {
    expect(() => loadConfig(write('bad.yaml', content))).toThrow(ConfigError);
  });

  it('rejects duplicate case names', () => {
    const content = `${VALID}  - name: one\n    assert:\n      - { type: is-json }\n`;
    expect(() => loadConfig(write('dup.yaml', content))).toThrow(/unique/);
  });

  it('reports a missing file clearly', () => {
    expect(() => loadConfig(join(dir, 'nope.yaml'))).toThrow(/Could not read/);
  });
});

describe('createProvider', () => {
  let server: Server;
  let baseUrl: string;
  const seen: { auth?: string | undefined; body: Record<string, unknown> }[] = [];
  let replies: { status: number; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        seen.push({ auth: req.headers.authorization, body: JSON.parse(data) as Record<string, unknown> });
        const reply = replies.shift() ?? { status: 500, body: 'no reply set' };
        res.writeHead(reply.status, { 'Content-Type': 'application/json' });
        res.end(reply.body);
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
  });

  afterAll(() => {
    server.close();
  });

  const config = (extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
    baseUrl,
    model: 'test',
    temperature: 0,
    timeoutMs: 3000,
    ...extra,
  });
  const ok = (content: string) => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content } }] }) });

  it('sends a chat request and returns the text', async () => {
    replies = [ok('hello')];
    const reply = await createProvider(config()).complete([{ role: 'user', content: 'hi' }]);

    expect(reply).toBe('hello');
    expect(seen.at(-1)?.body).toMatchObject({ model: 'test', temperature: 0 });
    expect(seen.at(-1)?.auth).toBeUndefined();
  });

  it('sends the key from the environment, but keeps it out of the cache id', async () => {
    process.env.PB_TEST_KEY = 'secret-value';
    replies = [ok('hi')];
    const provider = createProvider(config({ apiKeyEnv: 'PB_TEST_KEY' }));
    await provider.complete([{ role: 'user', content: 'hi' }]);

    expect(seen.at(-1)?.auth).toBe('Bearer secret-value');
    expect(provider.id).not.toContain('secret-value');
  });

  it('fails clearly when the key variable is missing', () => {
    expect(() => createProvider(config({ apiKeyEnv: 'PB_MISSING' }))).toThrow(/PB_MISSING is not set/);
  });

  it('retries once on a temporary failure', async () => {
    replies = [{ status: 503, body: 'busy' }, ok('recovered')];
    expect(await createProvider(config()).complete([{ role: 'user', content: 'x' }])).toBe('recovered');
  });

  it('does not retry a request that can never succeed', async () => {
    replies = [{ status: 400, body: 'bad model' }, ok('never')];
    await expect(createProvider(config()).complete([{ role: 'user', content: 'x' }])).rejects.toThrow(ProviderError);
    replies = [];
  });

  it('treats an empty reply as an error, so it is never graded or cached', async () => {
    replies = [ok('')];
    await expect(createProvider(config()).complete([{ role: 'user', content: 'x' }])).rejects.toThrow(/empty reply/);

    replies = [ok('<think>only thinking</think>')];
    await expect(createProvider(config()).complete([{ role: 'user', content: 'x' }])).rejects.toThrow(/empty reply/);
  });

  it('sends reasoning effort, and treats it as part of the cache identity', async () => {
    replies = [ok('hi')];
    const provider = createProvider(config({ reasoningEffort: 'none' }));
    await provider.complete([{ role: 'user', content: 'x' }]);

    expect(seen.at(-1)?.body).toMatchObject({ reasoning_effort: 'none' });
    expect(provider.id).not.toBe(createProvider(config()).id);
  });

  it('removes inline thinking', () => {
    expect(stripThinking('<think>hmm\nok</think>\n\nThe answer')).toBe('The answer');
  });
});

const result = (name: string, pass: boolean, output: string): CaseResult => ({ name, pass, output, assertions: [] });

function runOf(prompt: string, cases: CaseResult[]): PromptRun {
  const passed = cases.filter((c) => c.pass).length;
  return { prompt, cases, passed, total: cases.length, passRate: passed / cases.length, modelCalls: 0, cacheHits: 0, errors: 0 };
}

describe('diff', () => {
  it('labels every kind of change', () => {
    const a = runOf('v1', [result('fix', false, 'a'), result('break', true, 'a'), result('edit', true, 'a'), result('same', true, 'a')]);
    const b = runOf('v2', [result('fix', true, 'b'), result('break', false, 'b'), result('edit', true, 'b'), result('same', true, 'a')]);

    expect(compareRuns(a, b).map((r) => [r.name, r.change])).toEqual([
      ['fix', 'fixed'],
      ['break', 'regressed'],
      ['edit', 'changed'],
      ['same', 'same'],
    ]);
  });

  it('wraps text, including words longer than the column', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrap('a\nb', 10)).toEqual(['a', 'b']);
  });

  it('keeps both columns aligned', () => {
    const lines = sideBySide('left', 'one two three four five six', 45).split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.startsWith('left')).toBe(true);
  });

  it('separates a failed eval from one that could not run', () => {
    const clean = runOf('v1', [result('a', true, 'x')]);
    const broken = { ...clean, errors: 1 };

    expect(ciExitCode([clean], false)).toBe(0);
    expect(ciExitCode([clean], true)).toBe(1);
    expect(ciExitCode([clean, broken], true)).toBe(2);
    expect(ciExitCode([broken], false)).toBe(2);
  });

  it('formats percentages without noise', () => {
    expect(percent(1)).toBe('100%');
    expect(percent(0.875)).toBe('87.5%');
  });
});
