import {
  query,
  tool,
  createSdkMcpServer,
  type Query,
  type SDKUserMessage,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { InputQueue } from './input.js';
import { childEnvironment } from './config.js';
import { FIXTURE_ROOT, CONFIG_DIRECTORY } from './paths.js';
import {
  clean,
  FIXED_PROMPT,
  type Snapshot,
  type Metrics,
  type ContextView,
} from '../shared/model.js';
export type LivePort = AsyncIterable<SDKMessage> &
  Pick<
    Query,
    | 'close'
    | 'initializationResult'
    | 'getContextUsage'
    | 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'
  >;
export type QueryFactory = (input: Parameters<typeof query>[0]) => LivePort;
export const number = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
export function usageView(raw: unknown): Metrics {
  const x = raw as {
    session?: {
      total_cost_usd?: number;
      model_usage?: Record<string, { inputTokens?: number; outputTokens?: number }>;
    };
    rate_limits_available?: boolean;
  };
  const models = Object.values(x?.session?.model_usage || {});
  return {
    source: 'live',
    costUsd: number(x?.session?.total_cost_usd),
    inputTokens: models.reduce((n, m) => n + number(m.inputTokens), 0),
    outputTokens: models.reduce((n, m) => n + number(m.outputTokens), 0),
    rateLimitsAvailable: x?.rate_limits_available === true,
  };
}
export function contextView(raw: unknown): ContextView {
  const x = raw as {
    totalTokens?: number;
    maxTokens?: number;
    percentage?: number;
    categories?: { name?: string; tokens?: number; kind?: string }[];
  };
  return {
    source: 'live',
    totalTokens: number(x?.totalTokens),
    maxTokens: number(x?.maxTokens),
    // Derive a display percentage from counts; do not assume the raw field's unit.
    percentage:
      number(x?.maxTokens) > 0 ? (number(x?.totalTokens) / number(x?.maxTokens)) * 100 : 0,
    categories: (Array.isArray(x?.categories) ? x.categories : [])
      .slice(0, 25)
      .map((c) => ({ name: clean(c.name, 80), tokens: number(c.tokens), kind: clean(c.kind, 30) })),
  };
}
/** Keep SDK envelopes usable by /browser while projecting only classroom fields. */
export function messageView(message: SDKMessage): Record<string, unknown> {
  const x = message as unknown as Record<string, unknown>;
  const base = {
    type: x.type,
    uuid: typeof x.uuid === 'string' ? x.uuid : randomUUID(),
    session_id: clean(x.session_id, 100),
  };
  if (x.type === 'assistant' || x.type === 'user') {
    const m = x.message as { content?: unknown; id?: string };
    const content =
      typeof m?.content === 'string'
        ? clean(m.content)
        : Array.isArray(m?.content)
          ? m.content.flatMap((b: Record<string, unknown>): Record<string, unknown>[] =>
              b.type === 'text'
                ? [{ type: 'text', text: clean(b.text) }]
                : b.type === 'tool_use'
                  ? [
                      {
                        type: 'tool_use',
                        id: clean(b.id, 100),
                        name: clean(b.name, 100),
                        input: {},
                      },
                    ]
                  : b.type === 'tool_result'
                    ? [
                        {
                          type: 'tool_result',
                          tool_use_id: clean(b.tool_use_id, 100),
                          content: '[tool response body omitted]',
                          is_error: b.is_error === true,
                        },
                      ]
                    : [],
            )
          : [];
    return { ...base, message: { id: m?.id, role: x.type, content }, parent_tool_use_id: null };
  }
  if (x.type === 'result')
    return {
      ...base,
      subtype: clean(x.subtype),
      is_error: x.is_error === true,
      result: clean(x.result),
      errors: Array.isArray(x.errors) ? x.errors.map((e) => clean(e)) : [],
      total_cost_usd: number(x.total_cost_usd),
      usage: x.usage,
      modelUsage: x.modelUsage,
      duration_ms: number(x.duration_ms),
      duration_api_ms: number(x.duration_api_ms),
      num_turns: number(x.num_turns),
    };
  if (x.type === 'stream_event') {
    const e = x.event as { type?: string; delta?: { type?: string; text?: string } };
    return {
      ...base,
      event: {
        type: e?.type,
        ...(e?.delta?.type === 'text_delta'
          ? { delta: { type: 'text_delta', text: clean(e.delta.text) } }
          : {}),
      },
    };
  }
  return {
    ...base,
    subtype: clean(x.subtype),
    ...(typeof x.description === 'string' ? { description: clean(x.description) } : {}),
  };
}
export class LiveRuntime {
  input = new InputQueue<SDKUserMessage>();
  controller = new AbortController();
  handle?: LivePort;
  server?: ReturnType<typeof createSdkMcpServer>;
  timer?: ReturnType<typeof setTimeout>;
  closed = false;
  work?: Promise<void>;
  metrics?: Metrics;
  context?: ContextView;
  constructor(
    private snapshot: Snapshot,
    private publish: (p: Record<string, unknown>, ephemeral?: boolean) => void,
    private driver: () => void,
    private finish: (error?: string) => void,
    private factory: QueryFactory = query,
  ) {}
  async start() {
    await mkdir(CONFIG_DIRECTORY, { recursive: true });
    if (this.closed) throw Error('Session closed');
    this.server = createSdkMcpServer({
      name: 'page-snapshot',
      version: '1.0.0',
      tools: [
        tool(
          'inspect_page',
          'Inspect the fixed local page DOM snapshot captured by the browser host.',
          { target: z.literal('bundled-page') },
          async () => {
            this.driver();
            return { content: [{ type: 'text', text: JSON.stringify(this.snapshot) }] };
          },
          { annotations: { readOnlyHint: true, openWorldHint: false } },
        ),
      ],
    });
    this.handle = this.factory({
      prompt: this.input,
      options: {
        cwd: FIXTURE_ROOT,
        env: childEnvironment(),
        tools: [],
        allowedTools: ['mcp__page__inspect_page'],
        mcpServers: { page: this.server },
        settingSources: [],
        skills: [],
        persistSession: false,
        permissionMode: 'dontAsk',
        maxTurns: 4,
        maxBudgetUsd: 0.25,
        includePartialMessages: true,
        abortController: this.controller,
        systemPrompt:
          'You are a concise accessibility tutor. Use inspect_page once. Only the bundled snapshot is available; no navigation or other actions are possible. Distinguish observed facts from assumptions.',
        ...(process.env.ANTHROPIC_MODEL ? { model: process.env.ANTHROPIC_MODEL } : {}),
      },
    });
    this.timer = setTimeout(() => this.controller.abort(), 90000);
    await this.handle.initializationResult();
    if (this.closed) throw Error('Session closed');
  }
  send() {
    if (!this.handle || this.closed) throw Error('Live query is not ready');
    this.input.push({
      type: 'user',
      uuid: randomUUID(),
      session_id: '',
      parent_tool_use_id: null,
      message: { role: 'user', content: FIXED_PROMPT },
    });
    this.work = this.pump();
  }
  private async pump() {
    let resultSeen = false;
    let failure: string | undefined;
    try {
      for await (const message of this.handle!) {
        this.controller.signal.throwIfAborted();
        this.publish(messageView(message), message.type === 'stream_event');
        if (message.type === 'result') {
          resultSeen = true;
          await Promise.allSettled([this.inspectUsage(), this.inspectContext()]);
          if (message.subtype !== 'success')
            failure = 'The real SDK returned an unsuccessful result.';
          break;
        }
      }
      if (!resultSeen) throw Error('Live stream ended without a result.');
    } catch (e) {
      failure = clean(e instanceof Error ? e.message : 'Live query failed');
    } finally {
      try {
        await this.close();
      } catch {
        failure ||= 'Live cleanup failed.';
      }
      this.finish(failure);
    }
  }
  async inspectUsage() {
    if (this.closed && this.metrics) return this.metrics;
    if (!this.handle || this.closed) throw Error('Live usage is not available');
    this.metrics = usageView(
      await this.handle.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
        skipBehaviors: true,
      }),
    );
    return this.metrics;
  }
  async inspectContext() {
    if (this.closed && this.context) return this.context;
    if (!this.handle || this.closed) throw Error('Live context is not available');
    this.context = contextView(await this.handle.getContextUsage({ detail: 'summary' }));
    return this.context;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.input.close();
    this.controller.abort();
    try {
      this.handle?.close();
    } finally {
      await this.server?.instance.close().catch(() => {});
    }
  }
}
