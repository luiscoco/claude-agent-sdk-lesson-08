import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApiHandler } from '../src/server/app.js';
const snapshot = { title: 'Fixture', headings: [], links: [], images: [] };
test('local HTTP API validates boundaries, capacity, credentials and cleanup', async () => {
  const api = createApiHandler({ liveAvailable: false, tickMs: 5 });
  const server = createServer((q, s) => void api(q, s));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (p: string, x: unknown, headers = {}) =>
    fetch(base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(x),
    });
  try {
    const meta = await (await fetch(base + '/api/meta')).json();
    assert.equal(meta.liveAvailable, false);
    assert.ok(!JSON.stringify(meta).includes('ANTHROPIC_API_KEY'));
    assert.equal(
      (await post('/api/sessions', { mode: 'live', requestDialog: false, snapshot })).status,
      409,
    );
    assert.equal(
      (
        await post('/api/sessions', {
          mode: 'practice',
          requestDialog: false,
          snapshot,
          prompt: 'arbitrary',
        })
      ).status,
      400,
    );
    assert.equal(
      (await post('/api/sessions', {}, { Origin: 'https://outside.example' })).status,
      403,
    );
    assert.equal((await post('/api/sessions', { long: 'x'.repeat(33000) })).status, 400);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await post('/api/sessions', { mode: 'practice', requestDialog: false, snapshot });
      assert.equal(r.status, 201);
      ids.push((await r.json()).id);
    }
    assert.equal(
      (await post('/api/sessions', { mode: 'practice', requestDialog: false, snapshot })).status,
      429,
    );
    assert.equal(
      (await fetch(base + `/api/sessions/${ids[0]}/stream`, { headers: { 'Last-Event-ID': '-1' } }))
        .status,
      400,
    );
    assert.equal(
      (await post(`/api/sessions/${ids[0]}/events`, { session_id: 'wrong', events: [] })).status,
      400,
    );
    assert.equal((await fetch(base + `/api/sessions/${ids[0]}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(base + `/api/sessions/${ids[0]}/status`)).status, 404);
  } finally {
    await api.dispose();
    server.closeAllConnections();
    await new Promise<void>((r, e) => server.close((x) => (x ? e(x) : r())));
  }
});
