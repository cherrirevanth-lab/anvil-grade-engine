# Rebuild contract — grade-engine

Anything that satisfies this document and passes `test/grade.test.mjs` is a valid reconstruction.
The tests are the oracle; this is the map.

## 1. File tree

```
01-grade-engine/
├─ package.json            type: module, scripts: test/start/verify, no dependencies
├─ src/index.mjs           exports grade(), LIMITS
├─ src/cli.mjs             stdin/file → result JSON; no args runs a passing demo
├─ test/grade.test.mjs     8 acceptance tests
├─ verify.mjs              runs tests + CLI smoke, writes evidence.json
├─ permission-manifest.json
├─ .github/workflows/ci.yml
├─ README.md
├─ SPEC.md
├─ SECURITY.md
├─ LICENSE
└─ .gitignore
```

## 2. Public API

```ts
const LIMITS = { sourceBytes: 65536, testsBytes: 65536, wallMs: 5000, memoryMb: 256, outputBytes: 65536 };
function grade(input: {
  source: string;
  tests: string;
  timeoutMs?: number;   // clamped to <= LIMITS.wallMs
  memoryMb?: number;    // clamped to <= LIMITS.memoryMb
}): Promise<{
  verdict: 'passed' | 'failed' | 'error' | 'killed';
  passed: number; failed: number; total: number;
  durationMs: number;
  stdout: string; stderr: string; truncated: boolean;
  reason: string | null;
  tests: Array<{ name: string; ok: boolean; ms: number; message?: string }>;
}>;
```

`grade` throws `TypeError` when `source` or `tests` is not a string.

## 3. Execution algorithm

1. Reject `source` whose UTF-8 length exceeds `sourceBytes` immediately:
   `verdict: 'killed'`, `reason: 'source-too-large'`, `durationMs: 0`, zero counts.
2. Create a temp directory. Write `submission.mjs` = `source`.
3. Write `harness.mjs` = prelude + `tests` + epilogue.
   - Prelude: import `node:assert/strict`, expose it as `globalThis.assert`; collect
     `globalThis.test(name, fn)` into an array; import `./submission.mjs` and capture a load error
     as `load error: <ErrorName>` (name only, never the stack).
   - Test body runs after the submission import, at module top level.
   - Epilogue: if no tests registered → fatal `no tests registered`. Otherwise run each test
     sequentially, catching errors into `{ name, ok, ms, message: whitespace-collapsed, 200 chars }`.
     Write `{ fatal, results }` to `process.env.ANVIL_RESULT`, exit 0.
4. Spawn `node --max-old-space-size=<memoryMb> harness.mjs` with cwd = temp dir, env = only
   `ANVIL_RESULT` and `PATH`, stdio piped.
5. Kill at `timeoutMs`. Capture each stream, cap at 64 KiB, set `truncated`.
6. Precedence:
   - timed out → `killed`, `reason: 'timeout'`
   - stderr matches `/heap out of memory|Allocation failed/i` → `killed`, `reason: 'memory'`
   - no result file → `error`, `reason: 'no-result'` or `exit-<code>`
   - `fatal` set → `error`, `reason: fatal`
   - all results ok → `passed`; otherwise `failed`
7. Delete the temp directory in `finally`. Return only the fixed result shape.

## 4. Invariants → owning test

| # | Invariant | Test |
|---|---|---|
| G1 | A passing submission reports `passed` and exact counts | `passing submission returns passed with counts` |
| G2 | No field of the result contains test source | `a wrong answer fails without leaking test source` |
| G3 | Syntax error is `error`, never `failed` | `a module syntax error is an error...` |
| G4 | Infinite loop becomes `killed/timeout` | `an infinite loop is killed...` |
| G5 | Output is capped and flagged | `learner stdout is captured and capped` |
| G6 | Oversized source never executes | `oversized source is rejected...` |
| G7 | Zero tests is an error, not a pass | `a submission with no tests registered...` |
| G8 | Non-string input throws | `rejects non-string input` |

## 5. Boundaries

This module isolates *faults*, not *adversaries*. It does not stop a learner from reading the
filesystem, spawning processes, or opening sockets. Production must place the same harness inside a
container with: no egress, read-only root, non-root uid, 64 PIDs, 16 MiB writable `/tmp`, all
capabilities dropped. The `grade()` interface is designed so that swap changes no caller.

## 6. Rebuild checklist

- [ ] `node --test test/` → 8 passing.
- [ ] `node src/cli.mjs` exits 0 and prints `"verdict": "passed"`.
- [ ] `node verify.mjs` writes `evidence.json` with `ok: true`.
- [ ] `grep -R "dependencies" package.json` shows no runtime dependency.
- [ ] Result object has exactly the fields in §2.
