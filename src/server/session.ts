import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import {
  DIALOG_KIND,
  clean,
  type Start,
  type Status,
  type Metrics,
  type ContextView,
} from '../shared/model.js';
import { EventLog, type Payload } from './wire.js';
import { LiveRuntime, type QueryFactory } from './live.js';
export class Session {
  id = randomUUID();
  log = new EventLog();
  state: Status['state'] = 'created';
  stage = 0;
  driverCalls = 0;
  dialog = 'Not requested';
  supported: string[] = [];
  started = false;
  initialized = false;
  live?: LiveRuntime;
  timer?: ReturnType<typeof setInterval>;
  expires: ReturnType<typeof setTimeout>;
  pendingDialog?: string;
  error?: string;
  processing = new Set<string>();
  responses = new Map<string, Payload>();
  closed = false;
  constructor(
    readonly config: Start,
    readonly onExpired: () => void,
    private factory?: QueryFactory,
    private tickMs = 1000,
  ) {
    this.expires = setTimeout(onExpired, 600000);
  }
  status(): Status {
    return {
      id: this.id,
      mode: this.config.mode,
      state: this.state,
      stage: this.stage,
      produced: this.log.sequence + this.log.ephemeralCount,
      durable: this.log.sequence,
      ephemeral: this.log.ephemeralCount,
      connections: this.log.clients.size,
      driverCalls: this.driverCalls,
      dialog: this.dialog,
      lastSequence: this.log.sequence,
      ...(this.error ? { error: this.error } : {}),
    };
  }
  attach(res: ServerResponse, cursor: number) {
    this.log.attach(res, cursor);
  }
  publish = (payload: Payload, ephemeral = false) => this.log.publish(payload, ephemeral);
  private reply(id: string, response: Payload, error?: string) {
    const payload = {
      type: 'control_response',
      response: {
        request_id: id,
        subtype: error ? 'error' : 'success',
        ...(error ? { error } : { response }),
      },
    };
    this.responses.set(id, payload);
    if (this.responses.size > 100) this.responses.delete(this.responses.keys().next().value!);
    this.publish(payload);
  }
  async receive(payload: Payload) {
    if (this.closed) throw Error('Session closed');
    if (payload.type === 'control_request') {
      const id = clean(payload.request_id, 120);
      if (!id) throw Error('Missing request_id');
      if (this.responses.has(id)) {
        this.publish(this.responses.get(id)!);
        return;
      }
      if (this.processing.has(id)) return;
      this.processing.add(id);
      try {
        const request = payload.request as Payload;
        switch (request?.subtype) {
          case 'initialize': {
            this.supported = Array.isArray(request.supportedDialogKinds)
              ? request.supportedDialogKinds
                  .filter((x): x is string => typeof x === 'string')
                  .slice(0, 10)
              : [];
            if (!this.initialized) {
              if (this.config.mode === 'live') {
                this.live = new LiveRuntime(
                  this.config.snapshot,
                  this.publish,
                  () => {
                    this.driverCalls++;
                  },
                  (error) => {
                    if (this.closed) return;
                    this.error = error;
                    this.state = error ? 'failed' : 'completed';
                  },
                  this.factory,
                );
                try {
                  await this.live.start();
                } catch (error) {
                  this.state = 'failed';
                  this.error = 'Live initialization failed.';
                  await this.live.close();
                  throw error;
                }
              }
              this.initialized = true;
              this.state = 'ready';
              this.publish({
                type: 'system',
                subtype: 'init',
                session_id: this.id,
                uuid: randomUUID(),
                model:
                  this.config.mode === 'practice'
                    ? 'synthetic-worker'
                    : process.env.ANTHROPIC_MODEL || 'SDK default',
              });
            }
            this.reply(id, {
              commands: [],
              models: [],
              account: {},
              output_style: 'default',
              lesson_protocol: 'narrow local teaching peer',
            });
            break;
          }
          case 'get_usage': {
            const m = await this.usage();
            this.reply(id, {
              session: {
                total_cost_usd: m.costUsd,
                model_usage: {
                  aggregate: { inputTokens: m.inputTokens, outputTokens: m.outputTokens },
                },
              },
              rate_limits_available: m.rateLimitsAvailable,
              rate_limits: null,
              subscription_type: null,
              behaviors: null,
              lesson_source: m.source,
            });
            break;
          }
          case 'get_context_usage': {
            const c = await this.context();
            this.reply(id, { ...c });
            break;
          }
          case 'interrupt': {
            await this.live?.close();
            clearInterval(this.timer);
            this.state = 'failed';
            this.error = 'Interrupted by host';
            this.reply(id, {});
            break;
          }
          default:
            this.reply(id, {}, 'Control method is outside this local teaching bridge.');
        }
      } catch (e) {
        this.reply(id, {}, clean(e instanceof Error ? e.message : 'Control request failed'));
      } finally {
        this.processing.delete(id);
      }
      return;
    }
    if (payload.type === 'control_response') {
      const r = payload.response as {
        request_id?: string;
        subtype?: string;
        response?: { behavior?: string; result?: { choice?: string } };
      };
      if (r?.request_id !== this.pendingDialog) return;
      if (
        r.subtype !== 'success' ||
        !['completed', 'cancelled'].includes(r.response?.behavior || '')
      )
        throw Error('Invalid lesson dialog response');
      if (r.response?.behavior === 'completed' && r.response.result?.choice !== 'review')
        throw Error('Invalid lesson dialog choice');
      this.pendingDialog = undefined;
      this.dialog =
        r.response?.behavior === 'completed' ? 'Completed by learner' : 'Dismissed by learner';
      this.state = 'running';
      return;
    }
    if (payload.type === 'user') {
      if (!this.initialized) throw Error('Initialize first');
      if (this.started) return;
      this.started = true;
      this.state = 'running';
      this.publish({
        type: 'user',
        session_id: this.id,
        uuid: randomUUID(),
        message: { role: 'user', content: 'Inspect the bundled page snapshot.' },
        parent_tool_use_id: null,
      });
      if (this.config.mode === 'live') {
        this.live!.send();
      } else this.timer = setInterval(() => this.tick(), this.tickMs);
      return;
    }
    throw Error('Unsupported event type');
  }
  private tick() {
    if (this.closed || this.state === 'waiting-dialog' || this.state === 'completed') return;
    this.stage++;
    if (this.stage === 2 && this.config.requestDialog) {
      if (this.supported.includes(DIALOG_KIND)) {
        this.pendingDialog = randomUUID();
        this.dialog = 'Waiting for learner';
        this.state = 'waiting-dialog';
        this.publish({
          type: 'control_request',
          request_id: this.pendingDialog,
          request: {
            subtype: 'request_user_dialog',
            dialog_kind: DIALOG_KIND,
            payload: {
              title: 'Review the bundled page?',
              description: 'A local teaching dialog. No external action will be performed.',
            },
            tool_use_id: 'practice-inspection',
          },
        });
        return;
      }
      this.dialog = 'Skipped: host did not advertise this kind';
    }
    if (this.stage === 3) this.driverCalls++;
    if (this.stage <= 6) {
      this.publish({
        type: 'assistant',
        uuid: randomUUID(),
        session_id: this.id,
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: `Practice stage ${this.stage}/6: ${['', 'Reading the host snapshot', 'Reviewing learner choice', 'Inspecting headings', 'Checking link text', 'Checking image alternatives', 'Preparing observations'][this.stage]}. Synthetic worker output.`,
            },
          ],
        },
      });
      this.publish(
        {
          type: 'stream_event',
          uuid: randomUUID(),
          session_id: this.id,
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'synthetic transient progress' },
          },
        },
        true,
      );
    }
    if (this.stage === 6) {
      clearInterval(this.timer);
      this.state = 'completed';
      this.publish({
        type: 'result',
        subtype: 'success',
        is_error: false,
        uuid: randomUUID(),
        session_id: this.id,
        result:
          'Practice observations: the page skips from h1 to h3; “Click here” lacks descriptive link text; the image has an empty alt attribute, whose appropriateness depends on its purpose. Synthetic analysis, not model output.',
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
        modelUsage: {},
        duration_ms: 6000,
        duration_api_ms: 0,
        num_turns: 1,
      });
    }
  }
  async usage(): Promise<Metrics> {
    if (this.config.mode === 'live') return this.live!.inspectUsage();
    return {
      source: 'synthetic',
      costUsd: 0,
      inputTokens: 100 * this.stage,
      outputTokens: 20 * this.stage,
      rateLimitsAvailable: false,
    };
  }
  async context(): Promise<ContextView> {
    if (this.config.mode === 'live') return this.live!.inspectContext();
    const total = 500 + this.stage * 50;
    return {
      source: 'synthetic',
      totalTokens: total,
      maxTokens: 2000,
      percentage: total / 20,
      categories: [
        { name: 'Fixture instructions', tokens: 300, kind: 'used' },
        { name: 'Fixture messages', tokens: total - 300, kind: 'used' },
        { name: 'Fixture free space', tokens: 2000 - total, kind: 'free' },
      ],
    };
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.state = 'closed';
    clearInterval(this.timer);
    clearTimeout(this.expires);
    if (this.pendingDialog)
      this.publish({ type: 'control_cancel_request', request_id: this.pendingDialog });
    this.pendingDialog = undefined;
    await this.live?.close();
    this.log.close();
  }
}
