import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const validRegex = (source: string, flags?: string) => {
  try {
    new RegExp(source, flags);
    return true;
  } catch {
    return false;
  }
};

const text = z.object({ value: z.string(), ignoreCase: z.boolean().default(false) });

const assertion = z.discriminatedUnion('type', [
  text.extend({ type: z.literal('contains') }).strict(),
  text.extend({ type: z.literal('not-contains') }).strict(),
  text.extend({ type: z.literal('equals') }).strict(),
  z
    .object({ type: z.literal('regex'), value: z.string(), flags: z.string().optional() })
    .strict()
    .refine((a) => validRegex(a.value, a.flags), { message: 'Invalid regular expression' }),
  z.object({ type: z.literal('is-json') }).strict(),
  z
    .object({ type: z.literal('json-field'), path: z.string().min(1), equals: z.unknown().optional() })
    .strict(),
  z.object({ type: z.literal('max-chars'), value: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('min-chars'), value: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('judge'), rubric: z.string().min(1) }).strict(),
]);

const provider = z
  .object({
    baseUrl: z.string().url().default('http://localhost:11434/v1'),
    model: z.string().min(1),
    /** The name of an environment variable. Keys are never written in config files. */
    apiKeyEnv: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).default(0),
    maxTokens: z.number().int().positive().optional(),
    /** Sent as reasoning_effort. `none` makes reasoning models far faster on simple tasks. */
    reasoningEffort: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().default(120_000),
  })
  .strict();

const prompt = z.union([
  z.string().min(1),
  z.object({ system: z.string().optional(), user: z.string().min(1) }).strict(),
  z.object({ file: z.string().min(1) }).strict(),
]);

const testCase = z
  .object({
    name: z.string().min(1),
    vars: z.record(z.string(), z.string()).default({}),
    assert: z.array(assertion).min(1, 'A case needs at least one assertion'),
  })
  .strict();

const configSchema = z
  .object({
    provider,
    judge: provider.optional(),
    prompts: z.record(z.string(), prompt),
    cases: z.union([z.array(testCase), z.string().min(1)]),
    threshold: z.number().min(0).max(1).default(1),
    concurrency: z.number().int().positive().default(2),
  })
  .strict();

export type Assertion = z.infer<typeof assertion>;
export type ProviderConfig = z.infer<typeof provider>;
export type TestCase = z.infer<typeof testCase>;

export interface PromptTemplate {
  system?: string;
  user: string;
}

export interface Config {
  provider: ProviderConfig;
  judge: ProviderConfig;
  prompts: Record<string, PromptTemplate>;
  cases: TestCase[];
  threshold: number;
  concurrency: number;
}

export class ConfigError extends Error {}

function describe(error: z.ZodError) {
  return error.issues.map((i) => `  ${i.path.join('.') || 'config'}: ${i.message}`).join('\n');
}

function readData(path: string) {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError(`Could not read ${path}`);
  }
  try {
    return parse(source) as unknown; // YAML is a superset of JSON, so this reads both
  } catch (error) {
    throw new ConfigError(`Could not parse ${path}: ${(error as Error).message}`);
  }
}

function resolvePrompt(value: z.infer<typeof prompt>, baseDir: string): PromptTemplate {
  if (typeof value === 'string') return { user: value };
  if (!('file' in value)) return value;

  const path = resolve(baseDir, value.file);
  try {
    return { user: readFileSync(path, 'utf8') };
  } catch {
    throw new ConfigError(`Could not read prompt file ${path}`);
  }
}

export function loadConfig(path: string): Config {
  const parsed = configSchema.safeParse(readData(path));
  if (!parsed.success) throw new ConfigError(`Invalid config in ${path}:\n${describe(parsed.error)}`);

  const baseDir = dirname(resolve(path));
  const data = parsed.data;

  let cases = data.cases;
  if (typeof cases === 'string') {
    const casesPath = resolve(baseDir, cases);
    const loaded = z.array(testCase).safeParse(readData(casesPath));
    if (!loaded.success) throw new ConfigError(`Invalid cases in ${casesPath}:\n${describe(loaded.error)}`);
    cases = loaded.data;
  }

  if (cases.length === 0) throw new ConfigError('There are no test cases to run.');
  if (Object.keys(data.prompts).length === 0) throw new ConfigError('There are no prompts to run.');

  const names = new Set<string>();
  for (const { name } of cases) {
    if (names.has(name)) throw new ConfigError(`Two cases are named "${name}". Names must be unique.`);
    names.add(name);
  }

  return {
    provider: data.provider,
    judge: data.judge ?? data.provider,
    prompts: Object.fromEntries(
      Object.entries(data.prompts).map(([name, value]) => [name, resolvePrompt(value, baseDir)]),
    ),
    cases,
    threshold: data.threshold,
    concurrency: data.concurrency,
  };
}
