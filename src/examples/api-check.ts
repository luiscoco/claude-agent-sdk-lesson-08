import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { BrowserQueryOptions } from '@anthropic-ai/claude-agent-sdk/browser';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.version, '0.3.310');
type Instrumentation = Pick<
  Query,
  'getContextUsage' | 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'
>;
const expected: (keyof Instrumentation)[] = [
  'getContextUsage',
  'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET',
];
const transport: keyof BrowserQueryOptions = 'sse';
console.log(
  `Installed SDK ${pkg.version}; browser transport: ${transport}; methods: ${expected.join(', ')}. Browser query requires an async iterable prompt and one transport. No getUsage() alias is assumed.`,
);
