import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { LiveRuntime } from '../server/live.js';
import { PROJECT_ROOT } from '../server/paths.js';
import path from 'node:path';
if (existsSync(path.join(PROJECT_ROOT, '.env'))) loadEnvFile(path.join(PROJECT_ROOT, '.env'));
if (!process.env.ANTHROPIC_API_KEY)
  throw Error('Supply your own server-side ANTHROPIC_API_KEY in .env.');
console.log(
  'Real billable SDK query, <= $0.25 budget. CLI uses a fixed fixture snapshot; the browser UI captures the actual bundled DOM.',
);
let calls = 0,
  final = '';
let failed: string | undefined;
const runtime = new LiveRuntime(
  {
    title: 'Orbit Help Center',
    headings: [
      { level: 1, text: 'How can we help?' },
      { level: 3, text: 'Start with the essentials' },
    ],
    links: [{ text: 'Click here', href: '#start' }],
    images: [{ alt: '' }],
  },
  (m) => {
    if (m.type === 'result') final = String(m.result || '');
  },
  () => calls++,
  (e) => {
    failed = e;
  },
);
try {
  await runtime.start();
  runtime.send();
  await runtime.work;
  assert.equal(failed, undefined);
  assert.equal(calls, 1);
  assert.ok(final);
  console.log(
    JSON.stringify(
      {
        driverCalls: calls,
        final,
        usage: await runtime.inspectUsage(),
        context: await runtime.inspectContext(),
      },
      null,
      2,
    ),
  );
} finally {
  await runtime.close();
}
