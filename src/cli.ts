#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Cache } from './cache.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { init } from './init.js';
import { createProvider, ProviderError } from './provider.js';
import { ciExitCode, compareRuns, formatCase, formatDiff, formatSummary } from './report.js';
import { runPrompt, TemplateError, type PromptRun, type RunOptions } from './runner.js';

const HELP = `PromptBench: a local eval runner for LLM features.

Usage:
  promptbench init                 Create a sample promptbench.yaml
  promptbench run                  Run every prompt against every case
  promptbench diff <a> <b>         Compare two prompts side by side

Options:
  -c, --config <file>      Config file (default: promptbench.yaml)
  -p, --prompt <name>      Run only this prompt
      --ci                 Exit 1 below the threshold, or on any regression in diff
      --threshold <0-1>    Override the threshold in the config
      --no-cache           Ignore cached replies and call the model again
      --json <file>        Write the full results to a JSON file
  -v, --version            Show the version
  -h, --help               Show this help

Exit codes: 0 success, 1 eval failed under --ci, 2 eval could not run.
`;

const options = {
  config: { type: 'string', short: 'c', default: 'promptbench.yaml' },
  prompt: { type: 'string', short: 'p' },
  ci: { type: 'boolean', default: false },
  threshold: { type: 'string' },
  'no-cache': { type: 'boolean', default: false },
  json: { type: 'string' },
  version: { type: 'boolean', short: 'v', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

class UsageError extends Error {}

function readThreshold(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new UsageError('--threshold must be a number from 0 to 1.');
  }
  return threshold;
}

function createOptions(config: Config, cache: Cache | undefined, onCase?: RunOptions['onCase']): RunOptions {
  return {
    provider: createProvider(config.provider),
    judge: createProvider(config.judge),
    cache,
    concurrency: config.concurrency,
    ...(onCase ? { onCase } : {}),
  };
}

function pickPrompt(config: Config, name: string) {
  const template = config.prompts[name];
  if (!template) {
    const known = Object.keys(config.prompts).join(', ');
    throw new UsageError(`No prompt named "${name}". Available: ${known}`);
  }
  return template;
}

async function run(config: Config, cache: Cache | undefined, promptName: string | undefined) {
  const names = promptName ? [promptName] : Object.keys(config.prompts);
  const runs: PromptRun[] = [];

  for (const name of names) {
    console.log(`\n${name}`);
    const template = pickPrompt(config, name);
    const options = createOptions(config, cache, (result) => console.log(formatCase(result)));
    runs.push(await runPrompt(name, template, config.cases, options));
  }
  return runs;
}

async function main() {
  const { values, positionals } = parseArgs({ options, allowPositionals: true });
  const [command, ...args] = positionals;

  if (values.version) {
    const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
    console.log(version);
    return 0;
  }

  if (values.help || !command) {
    console.log(HELP);
    return 0;
  }

  if (command === 'init') {
    init(values.config);
    console.log(`Created ${values.config}. Set your model, then run: promptbench run`);
    return 0;
  }

  if (command !== 'run' && command !== 'diff') throw new UsageError(`Unknown command "${command}".\n\n${HELP}`);

  const config = loadConfig(values.config);
  const threshold = readThreshold(values.threshold, config.threshold);
  const cachePath = join(dirname(resolve(values.config)), '.promptbench', 'cache.sqlite');
  const cache = values['no-cache'] ? undefined : new Cache(cachePath);

  try {
    if (command === 'run') {
      const runs = await run(config, cache, values.prompt);

      console.log('');
      for (const result of runs) console.log(`${result.prompt}\n${formatSummary(result, threshold)}`);
      if (values.json) writeFileSync(values.json, JSON.stringify({ threshold, runs }, null, 2));

      const failed = runs.some((r) => r.passRate < threshold);
      return values.ci ? ciExitCode(runs, failed) : 0;
    }

    const [left, right] = args;
    if (!left || !right) throw new UsageError('diff needs two prompt names, for example: promptbench diff v1 v2');

    const shared = createOptions(config, cache);
    const a = await runPrompt(left, pickPrompt(config, left), config.cases, shared);
    const b = await runPrompt(right, pickPrompt(config, right), config.cases, shared);
    const rows = compareRuns(a, b);

    console.log(`\n${formatDiff(a, b, rows, process.stdout.columns || 100)}`);
    if (values.json) writeFileSync(values.json, JSON.stringify({ a, b, rows }, null, 2));

    const regressed = rows.some((row) => row.change === 'regressed');
    return values.ci ? ciExitCode([a, b], regressed) : 0;
  } finally {
    cache?.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: Error) => {
    const known =
      error instanceof ConfigError ||
      error instanceof UsageError ||
      error instanceof ProviderError ||
      error instanceof TemplateError ||
      (error as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS') ||
      error.message.endsWith('left unchanged.');
    console.error(known ? error.message : error);
    process.exitCode = 2;
  },
);
