import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/server/session.js';
import {
  DIALOG_KIND,
  StartSchema,
  SnapshotSchema,
  clean,
  type Start,
} from '../src/shared/model.js';
export const snapshot = {
  title: 'Fixture',
  headings: [
    { level: 1, text: 'Help' },
    { level: 3, text: 'Start' },
  ],
  links: [{ text: 'Click here', href: '#start' }],
  images: [{ alt: '' }],
};
const config: Start = { mode: 'practice', requestDialog: false, snapshot };
const wait = async (check: () => boolean) => {
  const end = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > end) throw Error('Fixture deadline exceeded');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const init = (s: Session, kinds: string[] = []) =>
  s.receive({
    type: 'control_request',
    request_id: 'init',
    request: { subtype: 'initialize', supportedDialogKinds: kinds },
  });
test('strict start schema bounds snapshots and rejects arbitrary tasks', () => {
  assert.equal(StartSchema.safeParse({ ...config, prompt: 'custom' }).success, false);
  assert.equal(
    SnapshotSchema.safeParse({ ...snapshot, headings: [{ level: 9, text: 'x' }] }).success,
    false,
  );
  assert.equal(SnapshotSchema.safeParse({ ...snapshot, title: 'x'.repeat(161) }).success, false);
  assert.equal(clean('sk-ant-test_secret'), '[redacted]');
});
test('practice runs without a delivery client and retains durable events', async () => {
  const s = new Session(config, () => {}, undefined, 5);
  try {
    await init(s);
    await s.receive({ type: 'user' });
    await wait(() => s.state === 'completed');
    assert.equal(s.log.clients.size, 0);
    assert.equal(s.driverCalls, 1);
    assert.equal(s.stage, 6);
    assert.equal(s.log.ephemeralCount, 6);
    assert.ok(s.log.durable.some((x) => x.payload.type === 'result'));
    assert.equal((await s.usage()).source, 'synthetic');
    assert.equal((await s.context()).totalTokens, 800);
  } finally {
    await s.close();
  }
});
test('unadvertised dialog kind is never requested', async () => {
  const s = new Session({ ...config, requestDialog: true }, () => {}, undefined, 5);
  try {
    await init(s);
    await s.receive({ type: 'user' });
    await wait(() => s.state === 'completed');
    assert.match(s.dialog, /Skipped/);
    assert.ok(!s.log.durable.some((x) => x.payload.type === 'control_request'));
  } finally {
    await s.close();
  }
});
for (const behavior of ['completed', 'cancelled'] as const)
  test(`dialog ${behavior} explicitly settles and duplicate responses are ignored`, async () => {
    const s = new Session({ ...config, requestDialog: true }, () => {}, undefined, 5);
    try {
      await init(s, [DIALOG_KIND]);
      await s.receive({ type: 'user' });
      await wait(() => s.state === 'waiting-dialog');
      const id = s.pendingDialog;
      assert.ok(id);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(s.stage, 2);
      const payload = {
        type: 'control_response',
        response: {
          request_id: id,
          subtype: 'success',
          response: {
            behavior,
            ...(behavior === 'completed' ? { result: { choice: 'review' } } : {}),
          },
        },
      };
      await s.receive(payload);
      await s.receive(payload);
      await wait(() => s.state === 'completed');
      assert.equal(s.pendingDialog, undefined);
      assert.equal(s.driverCalls, 1);
    } finally {
      await s.close();
    }
  });
test('malformed declared dialog result does not dismiss it', async () => {
  const s = new Session({ ...config, requestDialog: true }, () => {}, undefined, 5);
  try {
    await init(s, [DIALOG_KIND]);
    await s.receive({ type: 'user' });
    await wait(() => !!s.pendingDialog);
    await assert.rejects(
      s.receive({
        type: 'control_response',
        response: {
          request_id: s.pendingDialog,
          subtype: 'success',
          response: { behavior: 'completed', result: { choice: 'other' } },
        },
      }),
      /choice/,
    );
    assert.equal(s.state, 'waiting-dialog');
  } finally {
    await s.close();
  }
});
test('request retries replay responses without rerunning initialization', async () => {
  const s = new Session(config, () => {});
  try {
    await init(s);
    await init(s);
    assert.equal(s.log.durable.filter((e) => e.payload.type === 'system').length, 1);
    assert.equal(s.log.durable.filter((e) => e.payload.type === 'control_response').length, 2);
    await s.receive({
      type: 'control_request',
      request_id: 'unsupported',
      request: { subtype: 'arbitrary_method' },
    });
    const last = s.log.durable.at(-1)!.payload.response as { subtype: string };
    assert.equal(last.subtype, 'error');
  } finally {
    await s.close();
  }
});
test('close is idempotent and cancels a parked dialog', async () => {
  const s = new Session({ ...config, requestDialog: true }, () => {}, undefined, 5);
  await init(s, [DIALOG_KIND]);
  await s.receive({ type: 'user' });
  await wait(() => !!s.pendingDialog);
  await s.close();
  await s.close();
  assert.equal(s.state, 'closed');
  assert.equal(s.pendingDialog, undefined);
  assert.equal(s.log.durable.at(-1)!.payload.type, 'control_cancel_request');
  await assert.rejects(s.receive({ type: 'user' }), /closed/);
});
