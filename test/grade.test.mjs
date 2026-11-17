// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { grade, LIMITS } from '../src/index.mjs';

const okSource = `
export const add = (a, b) => a + b;
export const reverse = (s) => [...s].reverse().join('');
`;

const okTests = `
test('add', (m) => assert.equal(m.add(2, 3), 5));
test('reverse', (m) => assert.equal(m.reverse('abc'), 'cba'));
`;

test('passing submission returns passed with counts', async () => {
  const r = await grade({ source: okSource, tests: okTests });
  assert.equal(r.verdict, 'passed');
  assert.equal(r.passed, 2);
  assert.equal(r.failed, 0);
  assert.equal(r.total, 2);
  assert.deepEqual(r.tests.map((t) => t.name), ['add', 'reverse']);
  assert.ok(r.durationMs >= 0);
});

test('a wrong answer fails without leaking test source', async () => {
  const sentinel = 'HIDDEN_SENTINEL_9f2c';
  const tests = `
const ${sentinel} = 41;
test('add', (m) => assert.equal(m.add(2, 3), ${sentinel}));
`;
  const r = await grade({ source: okSource, tests });
  assert.equal(r.verdict, 'failed');
  assert.equal(r.passed, 0);
  assert.equal(r.failed, 1);
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes(sentinel), 'test source must never be serialized');
  assert.equal(r.tests[0].message.includes(sentinel), false);
});

test('a module syntax error is an error, not a failure', async () => {
  const r = await grade({ source: 'export const = ;', tests: okTests });
  assert.equal(r.verdict, 'error');
  assert.match(r.reason, /load error/);
  assert.equal(r.total, 0);
});

test('an infinite loop is killed at the wall-clock limit', async () => {
  const r = await grade({
    source: 'export function spin() { while (true) {} }',
    tests: "test('spin', (m) => m.spin());",
    timeoutMs: 400,
  });
  assert.equal(r.verdict, 'killed');
  assert.equal(r.reason, 'timeout');
});

test('learner stdout is captured and capped', async () => {
  const r = await grade({
    source: "console.log('x'.repeat(100000)); export const v = 1;",
    tests: "test('v', (m) => assert.equal(m.v, 1));",
  });
  assert.equal(r.verdict, 'passed');
  assert.equal(r.truncated, true);
  assert.ok(Buffer.byteLength(r.stdout, 'utf8') <= LIMITS.outputBytes);
});

test('oversized source is rejected before execution', async () => {
  const r = await grade({ source: 'a'.repeat(LIMITS.sourceBytes + 1), tests: okTests });
  assert.equal(r.verdict, 'killed');
  assert.equal(r.reason, 'source-too-large');
  assert.equal(r.durationMs, 0);
});

test('a submission with no tests registered is an error', async () => {
  const r = await grade({ source: okSource, tests: '// no tests' });
  assert.equal(r.verdict, 'error');
  assert.equal(r.reason, 'no tests registered');
});

test('rejects non-string input', async () => {
  await assert.rejects(() => grade({ source: 1, tests: okTests }), TypeError);
  await assert.rejects(() => grade(), TypeError);
});
