// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { grade, LIMITS } from './index.mjs';

const [file] = process.argv.slice(2);
const demo = {
  source: `export const add = (a, b) => a + b;\nexport const reverse = (s) => [...s].reverse().join('');\n`,
  tests: `
test('add returns the sum', (m) => { assert.equal(m.add(2, 3), 5); });
test('reverse handles unicode-ish strings', (m) => { assert.equal(m.reverse('abc'), 'cba'); });
`,
};

const input = file
  ? JSON.parse(readFileSync(file, 'utf8'))
  : demo;

const result = await grade(input);
process.stdout.write(JSON.stringify({ ...result, limits: LIMITS }, null, 2) + '\n');
process.exitCode = result.verdict === 'passed' ? 0 : 1;
