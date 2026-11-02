import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  LiveRuntime,
  messageView,
  usageView,
  contextView,
  type QueryFactory,
  type LivePort,
} from '../src/server/live.js';
const snapshot = { title: 'Fixture', headings: [], links: [], images: [] };
const final = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Observed fixture',
  session_id: 'test',
  total_cost_usd: 0.01,
} as SDKMessage;
const rawUsage = {
  session: { total_cost_usd: 0.01, model_usage: { one: { inputTokens: 12, outputTokens: 4 } } },
  rate_limits_available: false,
};
function fake(overrides: Partial<LivePort> = {}, messages: SDKMessage[] = [final]): LivePort {
  return {
    initializationResult: async () =>
      ({}) as unknown as Awaited<ReturnType<LivePort['initializationResult']>>,
    getContextUsage: async () =>
      ({
        totalTokens: 100,
        maxTokens: 1000,
        categories: [{ name: 'Messages', tokens: 100, kind: 'used' }],
      }) as unknown as Awaited<ReturnType<LivePort['getContextUsage']>>,
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () =>
      rawUsage as unknown as Awaited<
        ReturnType<LivePort['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']>
      >,
    close() {},
    [Symbol.asyncIterator]: async function* () {
      yield* messages;
    },
    ...overrides,
  };
}
test('usage accumulation and context occupancy remain distinct', () => {
  assert.deepEqual(usageView(rawUsage), {
    source: 'live',
    costUsd: 0.01,
    inputTokens: 12,
    outputTokens: 4,
    rateLimitsAvailable: false,
  });
  assert.equal(
    contextView({ totalTokens: 100, maxTokens: 1000, percentage: 0.1, categories: [] }).percentage,
    10,
  );
});
test('projection excludes hidden reasoning, raw tool inputs and tool result bodies', () => {
  const m = {
    type: 'assistant',
    message: {
      content: [
        { type: 'thinking', thinking: 'PRIVATE' },
        { type: 'tool_use', name: 'inspect_page', id: 't1', input: { secret: 'PRIVATE' } },
        { type: 'text', text: 'sk-ant-test_secret' },
      ],
    },
  } as unknown as SDKMessage;
  const p = JSON.stringify(messageView(m));
  assert.ok(!p.includes('PRIVATE'));
  assert.ok(!p.includes('sk-ant-'));
  assert.ok(p.includes('inspect_page'));
});
test('live fixed capabilities, actual inspection methods and final cache survive cleanup', async () => {
  let closed = false,
    finished = false,
    contextCalls = 0;
  const factory: QueryFactory = ({ options }) => {
    assert.deepEqual(options?.tools, []);
    assert.deepEqual(options?.allowedTools, ['mcp__page__inspect_page']);
    assert.equal(options?.maxBudgetUsd, 0.25);
    assert.equal(options?.maxTurns, 4);
    assert.equal(options?.permissionMode, 'dontAsk');
    return fake({
      close() {
        closed = true;
      },
      getContextUsage: async () => {
        contextCalls++;
        return { totalTokens: 100, maxTokens: 1000, categories: [] } as unknown as Awaited<
          ReturnType<LivePort['getContextUsage']>
        >;
      },
    });
  };
  const runtime = new LiveRuntime(
    snapshot,
    () => {},
    () => {},
    (error) => {
      assert.equal(error, undefined);
      assert.ok(closed);
      finished = true;
    },
    factory,
  );
  try {
    await runtime.start();
    runtime.send();
    await runtime.work;
    assert.ok(finished);
    assert.equal((await runtime.inspectUsage()).costUsd, 0.01);
    assert.equal((await runtime.inspectContext()).totalTokens, 100);
    assert.equal(contextCalls, 1);
  } finally {
    await runtime.close();
  }
});
test('active inspections refresh instead of serving stale snapshots', async () => {
  let calls = 0;
  const runtime = new LiveRuntime(
    snapshot,
    () => {},
    () => {},
    () => {},
    () =>
      fake({
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () =>
          ({
            ...rawUsage,
            session: { ...rawUsage.session, total_cost_usd: ++calls },
          }) as unknown as Awaited<
            ReturnType<LivePort['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']>
          >,
      }),
  );
  try {
    await runtime.start();
    assert.equal((await runtime.inspectUsage()).costUsd, 1);
    assert.equal((await runtime.inspectUsage()).costUsd, 2);
  } finally {
    await runtime.close();
  }
});
test('missing result fails the worker rather than inventing success', async () => {
  let failure = '';
  const runtime = new LiveRuntime(
    snapshot,
    () => {},
    () => {},
    (e) => {
      failure = e || '';
    },
    () => fake({}, []),
  );
  try {
    await runtime.start();
    runtime.send();
    await runtime.work;
    assert.match(failure, /without a result/);
  } finally {
    await runtime.close();
  }
});
test('unavailable instrumentation is reported separately from query success', async () => {
  let failed: string | undefined;
  const runtime = new LiveRuntime(
    snapshot,
    () => {},
    () => {},
    (e) => {
      failed = e;
    },
    () =>
      fake({
        getContextUsage: async () => {
          throw Error('Unavailable');
        },
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
          throw Error('Unavailable');
        },
      }),
  );
  try {
    await runtime.start();
    runtime.send();
    await runtime.work;
    assert.equal(failed, undefined);
    await assert.rejects(runtime.inspectUsage(), /not available/);
    await assert.rejects(runtime.inspectContext(), /not available/);
  } finally {
    await runtime.close();
  }
});
