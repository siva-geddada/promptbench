import { describe, expect, it, vi } from 'vitest';
import { check, type Judge } from '../src/assertions.js';
import type { Assertion } from '../src/config.js';

const noJudge: Judge = async () => {
  throw new Error('judge should not be called');
};
const pass = async (assertion: Assertion, output: string) => (await check(assertion, output, noJudge)).pass;

describe('text assertions', () => {
  it('contains is case sensitive unless told otherwise', async () => {
    expect(await pass({ type: 'contains', value: 'Hello', ignoreCase: false }, 'hello')).toBe(false);
    expect(await pass({ type: 'contains', value: 'Hello', ignoreCase: true }, 'hello')).toBe(true);
  });

  it('not-contains is the opposite', async () => {
    expect(await pass({ type: 'not-contains', value: 'sorry', ignoreCase: false }, 'all good')).toBe(true);
    expect(await pass({ type: 'not-contains', value: 'sorry', ignoreCase: false }, 'so sorry')).toBe(false);
  });

  it('equals ignores surrounding whitespace', async () => {
    expect(await pass({ type: 'equals', value: 'yes', ignoreCase: false }, ' yes\n')).toBe(true);
    expect(await pass({ type: 'equals', value: 'yes', ignoreCase: false }, 'yes.')).toBe(false);
  });

  it('regex uses flags', async () => {
    expect(await pass({ type: 'regex', value: '^order-\\d+$', flags: 'i' }, 'ORDER-42')).toBe(true);
    expect(await pass({ type: 'regex', value: '^order-\\d+$' }, 'ORDER-42')).toBe(false);
  });

  it('checks length limits inclusively', async () => {
    expect(await pass({ type: 'max-chars', value: 3 }, 'abc')).toBe(true);
    expect(await pass({ type: 'max-chars', value: 3 }, 'abcd')).toBe(false);
    expect(await pass({ type: 'min-chars', value: 3 }, 'abc')).toBe(true);
    expect(await pass({ type: 'min-chars', value: 3 }, 'ab')).toBe(false);
  });
});

describe('JSON assertions', () => {
  it('is-json rejects fenced or broken output', async () => {
    expect(await pass({ type: 'is-json' }, '{"a":1}')).toBe(true);
    expect(await pass({ type: 'is-json' }, '```json\n{"a":1}\n```')).toBe(false);
  });

  it('json-field reads nested paths and array indexes', async () => {
    const output = '{"user":{"tags":["a","b"]}}';
    expect(await pass({ type: 'json-field', path: 'user.tags.1', equals: 'b' }, output)).toBe(true);
    expect(await pass({ type: 'json-field', path: 'user.tags.1', equals: 'x' }, output)).toBe(false);
    expect(await pass({ type: 'json-field', path: 'user.name' }, output)).toBe(false);
    expect(await pass({ type: 'json-field', path: 'user' }, output)).toBe(true);
  });

  it('compares objects by value', async () => {
    expect(await pass({ type: 'json-field', path: 'a', equals: { b: 1 } }, '{"a":{"b":1}}')).toBe(true);
  });

  it('does not treat inherited properties as fields', async () => {
    expect(await pass({ type: 'json-field', path: 'constructor' }, '{}')).toBe(false);
  });

  it('fails cleanly on non-JSON output', async () => {
    const result = await check({ type: 'json-field', path: 'a' }, 'not json', noJudge);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('not JSON');
  });
});

describe('judge assertion', () => {
  it('uses the verdict and passes the rubric and output', async () => {
    const judge = vi.fn<Judge>(async () => ({ pass: false, reason: 'too rude' }));
    const result = await check({ type: 'judge', rubric: 'Be polite' }, 'go away', judge);

    expect(judge).toHaveBeenCalledWith('Be polite', 'go away');
    expect(result).toMatchObject({ pass: false, message: 'judge: too rude' });
  });
});
