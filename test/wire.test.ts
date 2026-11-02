import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { EventLog } from '../src/server/wire.js';
class Sink extends EventEmitter {
  text = '';
  destroyed = false;
  writeHead() {
    return this;
  }
  flushHeaders() {}
  write(x: string) {
    this.text += x;
    return true;
  }
  end() {
    this.destroyed = true;
    this.emit('close');
  }
}
test('reconnect delivers durable events after cursor, not missed ephemeral frames', () => {
  const log = new EventLog();
  log.publish({ type: 'assistant', text: 'first' });
  log.publish({ type: 'stream_event', text: 'lost' }, true);
  log.publish({ type: 'assistant', text: 'second' });
  const sink = new Sink();
  log.attach(sink as unknown as ServerResponse, 1);
  assert.ok(sink.text.includes('second'));
  assert.ok(!sink.text.includes('first'));
  assert.ok(!sink.text.includes('lost'));
  assert.equal(log.sequence, 2);
  assert.equal(log.ephemeralCount, 1);
  log.close();
  assert.equal(log.clients.size, 0);
});
test('bounded retention discloses a catch-up gap', () => {
  const log = new EventLog();
  for (let i = 0; i < 205; i++) log.publish({ type: 'assistant', n: i });
  assert.equal(log.durable.length, 200);
  const sink = new Sink();
  log.attach(sink as unknown as ServerResponse, 1);
  assert.ok(sink.text.includes('catch_up_truncated'));
  log.close();
});
