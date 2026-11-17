// SPDX-License-Identifier: MIT
/**
 * grade-engine — deterministic hidden-test grader.
 *
 * One public entry point: `grade()`. It runs a learner submission plus a
 * server-held test file in a separate Node process, under a wall-clock and
 * memory limit, and returns counts + the learner's own output. Test source is
 * never included in the result.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const LIMITS = Object.freeze({
  sourceBytes: 65_536,
  testsBytes: 65_536,
  wallMs: 5_000,
  memoryMb: 256,
  outputBytes: 65_536,
});

const PRELUDE = `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
globalThis.assert = assert;
const __tests = [];
globalThis.test = (name, fn) => {
  if (typeof fn !== 'function') throw new TypeError('test fn must be a function');
  __tests.push({ name: String(name).slice(0, 120), fn });
};
const __resultPath = process.env.ANVIL_RESULT;
let __mod = null;
let __fatal = null;
try {
  __mod = await import('./submission.mjs');
} catch (error) {
  __fatal = 'load error: ' + (error && error.name ? error.name : 'Error');
}
`;

const EPILOGUE = `
const __results = [];
if (!__fatal && __tests.length === 0) __fatal = 'no tests registered';
if (!__fatal) {
  for (const entry of __tests) {
    const started = Date.now();
    try {
      await entry.fn(__mod);
      __results.push({ name: entry.name, ok: true, ms: Date.now() - started });
    } catch (error) {
      const raw = String((error && error.message) || error || 'failed');
      const message = raw.replace(/\\s+/g, ' ').slice(0, 200);
      __results.push({ name: entry.name, ok: false, ms: Date.now() - started, message });
    }
  }
}
writeFileSync(__resultPath, JSON.stringify({ fatal: __fatal, results: __results }));
process.exit(0);
`;

function capped(chunks, bytes) {
  const all = Buffer.concat(chunks);
  if (all.length <= bytes) return { text: all.toString('utf8'), truncated: false };
  return { text: all.subarray(0, bytes).toString('utf8'), truncated: true };
}

function sanitize(result) {
  return {
    verdict: result.verdict,
    passed: result.passed,
    failed: result.failed,
    total: result.total,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.truncated,
    reason: result.reason ?? null,
    tests: result.tests,
  };
}

/**
 * @param {{ source: string, tests: string, timeoutMs?: number, memoryMb?: number }} input
 */
export async function grade(input) {
  const { source, tests } = input ?? {};
  if (typeof source !== 'string' || typeof tests !== 'string') {
    throw new TypeError('source and tests must be strings');
  }
  const sourceBytes = Buffer.byteLength(source, 'utf8');
  if (sourceBytes > LIMITS.sourceBytes) {
    return sanitize({
      verdict: 'killed',
      reason: 'source-too-large',
      passed: 0,
      failed: 0,
      total: 0,
      durationMs: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      tests: [],
    });
  }

  const timeoutMs = Math.min(input.timeoutMs ?? LIMITS.wallMs, LIMITS.wallMs);
  const memoryMb = Math.min(input.memoryMb ?? LIMITS.memoryMb, LIMITS.memoryMb);
  const dir = await mkdtemp(path.join(tmpdir(), 'anvil-grade-'));
  const resultPath = path.join(dir, 'result.json');
  const startedAt = Date.now();
  try {
    await writeFile(path.join(dir, 'submission.mjs'), source, 'utf8');
    await writeFile(path.join(dir, 'harness.mjs'), PRELUDE + tests + EPILOGUE, 'utf8');

    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${memoryMb}`, 'harness.mjs'],
      { cwd: dir, env: { ANVIL_RESULT: resultPath, PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const exit = await new Promise((resolve) => {
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timer);

    const durationMs = Date.now() - startedAt;
    const stdout = capped(out, LIMITS.outputBytes);
    const stderr = capped(err, LIMITS.outputBytes);
    const truncated = stdout.truncated || stderr.truncated;
    const stderrText = stderr.text;

    let payload = null;
    try {
      payload = JSON.parse(await readFile(resultPath, 'utf8'));
    } catch {
      payload = null;
    }

    if (timedOut) {
      return sanitize({
        verdict: 'killed',
        reason: 'timeout',
        passed: 0,
        failed: 0,
        total: 0,
        durationMs,
        stdout: stdout.text,
        stderr: stderrText,
        truncated,
        tests: [],
      });
    }

    if (/heap out of memory|Allocation failed/i.test(stderrText)) {
      return sanitize({
        verdict: 'killed',
        reason: 'memory',
        passed: 0,
        failed: 0,
        total: 0,
        durationMs,
        stdout: stdout.text,
        stderr: stderrText,
        truncated,
        tests: [],
      });
    }

    if (!payload) {
      return sanitize({
        verdict: 'error',
        reason: exit.code === 0 ? 'no-result' : `exit-${exit.code ?? exit.signal}`,
        passed: 0,
        failed: 0,
        total: 0,
        durationMs,
        stdout: stdout.text,
        stderr: stderrText,
        truncated,
        tests: [],
      });
    }

    if (payload.fatal) {
      return sanitize({
        verdict: 'error',
        reason: payload.fatal,
        passed: 0,
        failed: 0,
        total: 0,
        durationMs,
        stdout: stdout.text,
        stderr: stderrText,
        truncated,
        tests: [],
      });
    }

    const testsOut = payload.results.map((t) => ({
      name: t.name,
      ok: Boolean(t.ok),
      ms: t.ms,
      ...(t.ok ? {} : { message: t.message }),
    }));
    const passed = testsOut.filter((t) => t.ok).length;

    return sanitize({
      verdict: passed === testsOut.length ? 'passed' : 'failed',
      reason: null,
      passed,
      failed: testsOut.length - passed,
      total: testsOut.length,
      durationMs,
      stdout: stdout.text,
      stderr: stderrText,
      truncated,
      tests: testsOut,
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
