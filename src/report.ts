import { styleText } from 'node:util';
import type { CaseResult, PromptRun } from './runner.js';

const green = (text: string) => styleText('green', text);
const red = (text: string) => styleText('red', text);
const yellow = (text: string) => styleText('yellow', text);
const dim = (text: string) => styleText('dim', text);
const bold = (text: string) => styleText('bold', text);

export const percent = (rate: number) => `${(rate * 100).toFixed(1).replace(/\.0$/, '')}%`;

export function formatCase(result: CaseResult) {
  if (result.pass) return `  ${green('PASS')} ${result.name}`;
  if (result.error) return `  ${red('ERROR')} ${result.name}\n         ${result.error}`;

  const failures = result.assertions.filter((a) => !a.pass).map((a) => `         ${a.message}`);
  return [`  ${red('FAIL')} ${result.name}`, ...failures].join('\n');
}

export function formatSummary(run: PromptRun, threshold: number) {
  const rate = `${percent(run.passRate)} (${run.passed}/${run.total})`;
  const verdict = run.passRate >= threshold ? green('meets') : red('below');
  const usage = dim(`${run.modelCalls} model calls, ${run.cacheHits} cached`);
  const errors = run.errors ? `  ${red(`${run.errors} could not run`)}` : '';
  return `  ${bold(rate)} ${verdict} threshold ${percent(threshold)}  ${usage}${errors}`;
}

/** 2 means the eval couldn't be measured, which is different from a prompt getting worse. */
export function ciExitCode(runs: PromptRun[], failed: boolean) {
  if (runs.some((run) => run.errors > 0)) return 2;
  return failed ? 1 : 0;
}

export type Change = 'same' | 'changed' | 'fixed' | 'regressed';

export interface DiffRow {
  name: string;
  a: CaseResult;
  b: CaseResult;
  change: Change;
}

export function compareRuns(a: PromptRun, b: PromptRun): DiffRow[] {
  return a.cases.flatMap((left) => {
    const right = b.cases.find((c) => c.name === left.name);
    if (!right) return [];

    let change: Change = left.output === right.output ? 'same' : 'changed';
    if (!left.pass && right.pass) change = 'fixed';
    if (left.pass && !right.pass) change = 'regressed';
    return [{ name: left.name, a: left, b: right, change }];
  });
}

/** Wraps text to a width, breaking long words so columns never overflow. */
export function wrap(text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      let rest = word;
      while (rest.length > width) {
        if (line) lines.push(line);
        line = '';
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (!line) line = rest;
      else if (line.length + 1 + rest.length <= width) line += ` ${rest}`;
      else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function sideBySide(left: string, right: string, width: number) {
  const column = Math.max(20, Math.floor((width - 3) / 2));
  const a = wrap(left, column);
  const b = wrap(right, column);

  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => {
    return `${(a[i] ?? '').padEnd(column)} ${dim('|')} ${b[i] ?? ''}`.trimEnd();
  }).join('\n');
}

const LABELS: Record<Change, string> = {
  same: dim('SAME'),
  changed: yellow('CHANGED'),
  fixed: green('FIXED'),
  regressed: red('REGRESSED'),
};

const status = (result: CaseResult) => (result.error ? 'ERROR' : result.pass ? 'PASS' : 'FAIL');

export function formatDiff(a: PromptRun, b: PromptRun, rows: DiffRow[], width: number) {
  const blocks = rows
    .filter((row) => row.change !== 'same')
    .map((row) => {
      const header = `${LABELS[row.change]} ${bold(row.name)}`;
      const titles = sideBySide(`${a.prompt}: ${status(row.a)}`, `${b.prompt}: ${status(row.b)}`, width);
      return `${header}\n${titles}\n${sideBySide(row.a.error ?? row.a.output, row.b.error ?? row.b.output, width)}`;
    });

  const count = (change: Change) => rows.filter((row) => row.change === change).length;
  const summary = [
    `${a.prompt} ${percent(a.passRate)} -> ${b.prompt} ${percent(b.passRate)}`,
    `${count('fixed')} fixed, ${count('regressed')} regressed, ${count('changed')} changed, ${count('same')} same`,
  ].join('\n');

  return [...blocks, bold(summary)].join('\n\n');
}
