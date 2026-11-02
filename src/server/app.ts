import type { IncomingMessage, ServerResponse } from 'node:http';
import { StartSchema, VERSION } from '../shared/model.js';
import { Session } from './session.js';
import type { QueryFactory } from './live.js';
export function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage) {
  let n = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    n += Buffer.byteLength(chunk);
    if (n > 32768) throw Error('Body too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export function createApiHandler(
  options: { liveAvailable?: boolean; queryFactory?: QueryFactory; tickMs?: number } = {},
) {
  const sessions = new Map<string, Session>();
  const available = () => options.liveAvailable ?? Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  let closing = false;
  const api = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/')) return false;
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) {
      json(res, 403, { error: 'Use the loopback application URL.' });
      return true;
    }
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      json(res, 403, { error: 'Cross-origin requests refused.' });
      return true;
    }
    if (closing) {
      json(res, 503, { error: 'Host is closing.' });
      return true;
    }
    if (url.pathname === '/api/meta' && req.method === 'GET') {
      json(res, 200, {
        version: VERSION,
        liveAvailable: available(),
        model: process.env.ANTHROPIC_MODEL || 'SDK default',
      });
      return true;
    }
    if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) {
      json(res, 415, { error: 'Send application/json.' });
      return true;
    }
    try {
      if (url.pathname === '/api/sessions' && req.method === 'POST') {
        const parsed = StartSchema.safeParse(await body(req));
        if (!parsed.success) {
          json(res, 400, { error: 'Choose practice/live and supply a bounded host DOM snapshot.' });
          return true;
        }
        if (sessions.size >= 6) {
          json(res, 429, { error: 'Close an existing session first.' });
          return true;
        }
        if (parsed.data.mode === 'live' && !available()) {
          json(res, 409, { error: 'Configure the server-side ANTHROPIC_API_KEY for live mode.' });
          return true;
        }
        if (
          parsed.data.mode === 'live' &&
          [...sessions.values()].some(
            (s) =>
              s.config.mode === 'live' && !s.closed && !['completed', 'failed'].includes(s.state),
          )
        ) {
          json(res, 409, { error: 'One live session may run at a time.' });
          return true;
        }
        let session: Session;
        session = new Session(
          parsed.data,
          () => {
            void session.close();
            sessions.delete(session.id);
          },
          options.queryFactory,
          options.tickMs,
        );
        sessions.set(session.id, session);
        json(res, 201, { id: session.id, mode: session.config.mode, expiresInSeconds: 600 });
        return true;
      }
      const match = /^\/api\/sessions\/([\w-]+)(?:\/(stream|events|status))?$/.exec(url.pathname);
      if (!match) {
        json(res, 404, { error: 'Unknown endpoint.' });
        return true;
      }
      const s = sessions.get(match[1]!);
      if (!s) {
        json(res, 404, { error: 'Session not found or expired.' });
        return true;
      }
      if (req.method === 'GET' && match[2] === 'status') {
        json(res, 200, s.status());
        return true;
      }
      if (req.method === 'GET' && match[2] === 'stream') {
        const cursor = Number(req.headers['last-event-id'] || 0);
        if (!Number.isSafeInteger(cursor) || cursor < 0) {
          json(res, 400, { error: 'Invalid resume cursor.' });
          return true;
        }
        s.attach(res, cursor);
        return true;
      }
      if (req.method === 'DELETE' && !match[2]) {
        await s.close();
        sessions.delete(s.id);
        json(res, 200, { closed: true });
        return true;
      }
      if (req.method === 'POST' && match[2] === 'events') {
        const b = (await body(req)) as {
          session_id?: string;
          events?: { payload?: Record<string, unknown> }[];
        };
        if (
          b.session_id !== s.id ||
          !Array.isArray(b.events) ||
          b.events.length !== 1 ||
          !b.events[0]?.payload
        ) {
          json(res, 400, { error: 'Expected one event for this session.' });
          return true;
        }
        await s.receive(b.events[0].payload);
        json(res, 200, { accepted: true });
        return true;
      }
      json(res, 405, { error: 'Unsupported method.' });
    } catch {
      if (!res.headersSent)
        json(res, 400, { error: 'Invalid or unavailable teaching-protocol operation.' });
      else res.end();
    }
    return true;
  };
  return Object.assign(api, {
    async dispose() {
      closing = true;
      await Promise.all([...sessions.values()].map((s) => s.close()));
      sessions.clear();
    },
  });
}
