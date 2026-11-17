# grade-engine

Deterministic hidden-test grading for learner code, with the test source kept on the server.

Give it a submission and a test file. It runs both in a separate Node process under a wall-clock and
memory cap, and returns **counts plus the learner's own output** — never the tests.

```
passed  4/4
failed  3/4   ("add: expected 5, got 4")
killed  timeout at 400 ms
error   load error: SyntaxError
```

## Why

Every code-learning product leaks its tests eventually, because the graded payload and the hidden
assertions travel through the same layer. This module makes the test file an input to a child
process and the result an object with a fixed shape, so there is nothing to leak by accident. If the
result JSON is serialised to a browser, the tests are not in it. A test named after that invariant
enforces it.

## Quickstart

```sh
node --test test/     # 8 tests, ~1 s, no dependencies
node src/cli.mjs      # grades an inline demo lesson
node verify.mjs       # writes evidence.json
```

```js
import { grade } from './src/index.mjs';

const result = await grade({
  source: 'export const add = (a, b) => a + b;',
  tests: "test('add', (m) => assert.equal(m.add(2, 3), 5));",
});
// { verdict: 'passed', passed: 1, failed: 0, total: 1, stdout: '', ... }
```

## Contract

`grade({ source, tests, timeoutMs?, memoryMb? }) → Promise<Result>`

| Field | Meaning |
|---|---|
| `verdict` | `passed` \| `failed` \| `error` \| `killed` |
| `passed` / `failed` / `total` | counts, not data |
| `tests[]` | `{ name, ok, ms, message? }` — names are yours, not the test body |
| `stdout` / `stderr` | the learner's output, capped at 64 KiB each |
| `truncated` | true when either stream hit the cap |
| `reason` | `timeout`, `memory`, `source-too-large`, `load error: …`, `no tests registered` |
| `durationMs` | wall clock for the whole grade |

`killed` means a limit was hit and is deliberately distinguishable from `failed` — "your program ran
too long" is not "1 of 4 tests failed".

## Limits

| Limit | Value |
|---|---|
| source | 64 KiB |
| wall clock | 5 000 ms (`timeoutMs` may lower it) |
| heap | 256 MiB (`memoryMb` may lower it) |
| stdout / stderr | 64 KiB each, truncated |

## What this proves, and what it does not

Proven by `test/grade.test.mjs`: counts, verdicts, no test-source leak, timeout kill, output cap,
oversized-source rejection, missing-test detection.

Not proven here: OS-level isolation (this uses a child process, not a container), no-egress
enforcement, and filesystem confinement. A container/Piston runner belongs behind the same
`grade()` interface; see `SPEC.md § Boundaries`.

## Permissions

None at runtime. No network, no environment secrets. It writes one temporary directory under the OS
temp folder and removes it. The CI workflow requests `contents: read` only. See
`permission-manifest.json`.

## License

MIT © 2026 Revan
