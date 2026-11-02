import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
export type Payload = Record<string, unknown>;
export class EventLog {
  sequence = 0;
  durable: { sequence_num: number; event_id: string; source: string; payload: Payload }[] = [];
  clients = new Set<ServerResponse>();
  ephemeralCount = 0;
  publish(payload: Payload, ephemeral = false) {
    if (ephemeral) {
      this.ephemeralCount++;
      this.sendAll(`event: ephemeral_event\ndata: ${JSON.stringify({ payload })}\n\n`);
      return;
    }
    const event = {
      sequence_num: ++this.sequence,
      event_id: randomUUID(),
      source: 'worker',
      payload,
    };
    this.durable.push(event);
    this.durable = this.durable.slice(-200);
    this.sendAll(this.encode(event));
  }
  private encode(event: (typeof this.durable)[number]) {
    return `id: ${event.sequence_num}\nevent: client_event\ndata: ${JSON.stringify(event)}\n\n`;
  }
  private sendAll(frame: string) {
    for (const client of this.clients) if (!client.destroyed) client.write(frame);
  }
  attach(res: ServerResponse, after: number) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    if (this.durable.length && after < this.durable[0]!.sequence_num - 1)
      res.write('event: catch_up_truncated\ndata: {}\n\n');
    for (const event of this.durable) if (event.sequence_num > after) res.write(this.encode(event));
    this.clients.add(res);
    const timer = setInterval(() => {
      if (!res.destroyed) res.write(': heartbeat\n\n');
    }, 10000);
    res.once('close', () => {
      clearInterval(timer);
      this.clients.delete(res);
    });
  }
  close() {
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
