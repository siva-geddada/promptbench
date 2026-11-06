import { isDeepStrictEqual } from 'node:util';
import type { Assertion } from './config.js';

export interface AssertionResult {
  type: Assertion['type'];
  pass: boolean;
  message: string;
}

export type Judge = (rubric: string, output: string) => Promise<{ pass: boolean; reason: string }>;

const preview = (value: string) => (value.length > 60 ? `${value.slice(0, 57)}...` : value);

const fold = (value: string, ignoreCase: boolean) => (ignoreCase ? value.toLowerCase() : value);

function parseJson(output: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(output) };
  } catch {
    return { ok: false };
  }
}

/** Reads a dotted path such as `user.tags.0` from parsed JSON. */
function readPath(value: unknown, path: string) {
  let current = value;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      return { found: false as const };
    }
    current = (current as Record<string, unknown>)[key];
  }
  return { found: true as const, value: current };
}

const result = (type: Assertion['type'], pass: boolean, message: string): AssertionResult => ({
  type,
  pass,
  message,
});

export async function check(assertion: Assertion, output: string, judge: Judge): Promise<AssertionResult> {
  switch (assertion.type) {
    case 'contains': {
      const pass = fold(output, assertion.ignoreCase).includes(fold(assertion.value, assertion.ignoreCase));
      return result(assertion.type, pass, `should contain "${preview(assertion.value)}"`);
    }
    case 'not-contains': {
      const pass = !fold(output, assertion.ignoreCase).includes(fold(assertion.value, assertion.ignoreCase));
      return result(assertion.type, pass, `should not contain "${preview(assertion.value)}"`);
    }
    case 'equals': {
      const pass = fold(output.trim(), assertion.ignoreCase) === fold(assertion.value.trim(), assertion.ignoreCase);
      return result(assertion.type, pass, `should equal "${preview(assertion.value)}"`);
    }
    case 'regex': {
      const pass = new RegExp(assertion.value, assertion.flags).test(output);
      return result(assertion.type, pass, `should match /${preview(assertion.value)}/${assertion.flags ?? ''}`);
    }
    case 'is-json':
      return result(assertion.type, parseJson(output).ok, 'should be valid JSON');
    case 'json-field': {
      const parsed = parseJson(output);
      if (!parsed.ok) return result(assertion.type, false, `should have field "${assertion.path}", but output is not JSON`);

      const field = readPath(parsed.value, assertion.path);
      if (!field.found) return result(assertion.type, false, `should have field "${assertion.path}"`);
      if (assertion.equals === undefined) return result(assertion.type, true, `has field "${assertion.path}"`);

      const pass = isDeepStrictEqual(field.value, assertion.equals);
      return result(
        assertion.type,
        pass,
        `field "${assertion.path}" should equal ${JSON.stringify(assertion.equals)}, got ${JSON.stringify(field.value)}`,
      );
    }
    case 'max-chars':
      return result(
        assertion.type,
        output.length <= assertion.value,
        `should be at most ${assertion.value} characters, got ${output.length}`,
      );
    case 'min-chars':
      return result(
        assertion.type,
        output.length >= assertion.value,
        `should be at least ${assertion.value} characters, got ${output.length}`,
      );
    case 'judge': {
      const verdict = await judge(assertion.rubric, output);
      return result(assertion.type, verdict.pass, `judge: ${verdict.reason}`);
    }
  }
}
