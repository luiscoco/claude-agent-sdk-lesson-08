import { z } from 'zod';
export const VERSION = '0.3.310';
export const DIALOG_KIND = 'lesson_page_review';
export const FIXED_PROMPT =
  'Inspect the bundled page snapshot once with inspect_page. Give three short accessibility observations based only on that snapshot. Do not use other tools or invent page behavior.';
export const SnapshotSchema = z.strictObject({
  title: z.string().max(160),
  headings: z
    .array(z.strictObject({ level: z.number().int().min(1).max(6), text: z.string().max(180) }))
    .max(20),
  links: z.array(z.strictObject({ text: z.string().max(180), href: z.string().max(200) })).max(20),
  images: z.array(z.strictObject({ alt: z.string().max(180) })).max(20),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
export const StartSchema = z.strictObject({
  mode: z.enum(['practice', 'live']),
  requestDialog: z.boolean(),
  snapshot: SnapshotSchema,
});
export type Start = z.infer<typeof StartSchema>;
export type Status = {
  id: string;
  mode: Start['mode'];
  state: 'created' | 'ready' | 'running' | 'waiting-dialog' | 'completed' | 'failed' | 'closed';
  stage: number;
  produced: number;
  durable: number;
  ephemeral: number;
  connections: number;
  driverCalls: number;
  dialog: string;
  lastSequence: number;
  error?: string;
};
export type Metrics = {
  source: 'synthetic' | 'live';
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  rateLimitsAvailable: boolean;
};
export type ContextView = {
  source: 'synthetic' | 'live';
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  categories: { name: string; tokens: number; kind: string }[];
};
export const QUIZ = [
  {
    question: 'What does suspendSseStream(q) stop?',
    answers: [
      'Delivery on that SSE connection',
      'The remote query and its billing',
      'All host timers',
    ],
    correct: 0,
  },
  {
    question: 'Which object should resumeSseStream receive?',
    answers: ['A new query', 'The retained existing query', 'The model ID'],
    correct: 1,
  },
  {
    question: 'What opts the host into a dialog kind?',
    answers: [
      'A callback alone',
      'A DOM alert',
      'supportedDialogKinds plus an appropriate onUserDialog callback',
    ],
    correct: 2,
  },
  {
    question: 'Who supplies page inspection or automation?',
    answers: ['The host application and its driver', 'The SSE stream', 'The usage counter'],
    correct: 0,
  },
];
export function clean(value: unknown, max = 2500) {
  return typeof value === 'string'
    ? value.replace(/sk-ant-[\w-]+/g, '[redacted]').slice(0, max)
    : '';
}
export function summary(input: unknown): string {
  const x = input as Record<string, unknown>;
  if (!x || typeof x !== 'object') return 'Unknown message';
  if (x.type === 'result')
    return `result / ${clean(x.subtype)} · ${clean(x.result) || 'No success text'}`;
  if (x.type === 'assistant') {
    const m = x.message as { content?: { type: string; text?: string; name?: string }[] };
    return (
      'assistant · ' +
      (Array.isArray(m?.content)
        ? m.content
            .filter((b) => b.type === 'text' || b.type === 'tool_use')
            .map((b) => (b.type === 'text' ? clean(b.text) : `tool request ${clean(b.name)}`))
            .join(' ')
        : 'non-text')
    );
  }
  if (x.type === 'stream_event') return 'stream_event · provisional text/control (ephemeral)';
  return clean(x.type) + ' / ' + clean(x.subtype);
}
export const GUIDE = [
  [
    'Browser query',
    'Import query from /browser. Supply an async iterable prompt and exactly one SSE or WebSocket transport. This lab retains one Query object until Close session.',
  ],
  [
    'Two lifecycles',
    'Suspend closes event delivery, not the query. Worker progress can continue. Resume uses the same query object and the transport reconnects from its wire cursor. Sending a message or control request can also reopen a suspended stream.',
  ],
  [
    'Durable and ephemeral',
    'The local teaching peer retains durable client_event frames with sequence numbers. Ephemeral deltas sent while disconnected are lost. A catch-up gap must be disclosed; this lab warns rather than claiming a complete transcript.',
  ],
  [
    'Dialogs are host UI',
    'supportedDialogKinds advertises exactly what onUserDialog renders. The custom lesson_page_review dialog is a local teaching protocol, not a Claude-defined dialog kind. Unknown kinds return null; declared dialogs can be completed or explicitly dismissed.',
  ],
  [
    'A driver is a separate capability',
    'The host reads the bundled iframe DOM into a bounded snapshot. A live SDK MCP tool exposes that snapshot. This is a read-only DOM inspection adapter, not a general web navigation or computer-use driver.',
  ],
  [
    'Usage versus context',
    'Cost and token totals describe accumulated session usage. Context is a separate snapshot of window occupancy. On SDK 0.3.310 the usage method is usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(), not getUsage(). Context uses getContextUsage({detail:"summary"}).',
  ],
  [
    'Keep evidence honest',
    'Practice uses the actual browser SDK and network transport with synthetic worker output and metrics. Live uses a real Node SDK query and actual MCP tool execution. The bridge supports a narrow teaching subset of the remote protocol, not the complete Anthropic hosted-session service.',
  ],
  [
    'Explicit cleanup',
    'Closing the browser Query closes its transport. This host also sends DELETE to dispose the server query, MCP server, queues and timers. Closing a delivery stream alone does not request that cleanup.',
  ],
];
