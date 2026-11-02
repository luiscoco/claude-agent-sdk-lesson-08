import './style.css';
import './course-theme.css';
import './course-theme.js';
import { VERSION, GUIDE, QUIZ, summary, clean, type Start, type Status } from '../shared/model.js';
import { connectBrowser, type BrowserSession } from './browser.js';
import { dialogHandler } from './dialog.js';
import { inspectFrame } from './driver.js';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
document.querySelector('#app')!.innerHTML =
  `<header class="top"><a class="brand" href="/">◈ <span>AGENT LABS / 08</span></a><span>Browser SDK · ${VERSION}</span><a href="https://github.com/luiscoco/claude-agent-sdk-lesson-08">View source ↗</a></header><main><section class="hero"><div><p class="eyebrow">LESSON 8 / BROWSER SDK AND OBSERVABILITY</p><h1>One session.<br><em>Two lifecycles.</em></h1><p class="intro">Keep the query. Control the stream. See how a browser host coordinates user dialogs, page inspection and instrumentation.</p></div><div class="hero-art" aria-hidden="true"><span>QUERY · WORKING</span><b>↕</b><span>SSE · SUSPEND / RESUME</span><b>↓</b><span>HOST · OBSERVING</span></div></section><nav class="tabs" aria-label="Lesson views"><button data-tab="lab" aria-selected="true">01 Session lab</button><button data-tab="guide">02 Host responsibilities</button><button data-tab="quiz">03 Knowledge check</button></nav>
<section id="lab" class="view"><div class="workspace"><aside class="panel controls"><p class="eyebrow">CONNECT THE BROWSER HOST</p><label>Worker mode<select id="mode"><option value="practice">Practice · synthetic worker</option><option value="live">Live · real SDK + MCP</option></select></label><label class="check"><input id="advertise" type="checkbox" checked> Advertise lesson dialog kind</label><label class="check"><input id="request-dialog" type="checkbox" checked> Request a teaching dialog</label><p class="muted">Practice uses the real browser SDK and local SSE transport, with synthetic worker output and metrics. Live keeps your API key on the Node server.</p><p id="key" class="muted">Checking live configuration…</p><button id="start" class="primary">Create browser session</button><div class="actions"><button id="suspend" disabled>Suspend SSE</button><button id="resume" disabled>Resume same query</button><button id="inspect" disabled>Inspect usage & context</button><button id="close" disabled>Close session</button></div><hr><p class="eyebrow">RETAINED QUERY IDENTITY</p><p id="identity" class="tag">No session</p><p id="stream" class="muted">Delivery not connected</p><p id="cursor" class="muted">Delivered cursor: —</p><button id="export">Export observations ↓</button></aside>
<div class="observation"><div id="notice" class="notice" role="status">Create a practice session. Suspend delivery while the worker is running, then resume the same Query.</div><div class="metrics"><div><b id="worker">Idle</b><span>Host-reported worker state</span></div><div><b id="produced">0</b><span>Server-produced events</span></div><div><b id="received">0</b><span>SDK-yielded messages</span></div></div><section class="panel"><div class="section-head"><h2>Bundled page / host driver</h2><span class="tag">Read-only DOM adapter</span></div><iframe id="fixture" title="Bundled help center page" src="/fixture.html" sandbox="allow-same-origin"></iframe><details><summary>Snapshot passed to the inspection tool</summary><pre id="snapshot">Captured when the session starts.</pre></details><p id="driver" class="muted">Browser DOM captures: 0 · Worker inspection calls: 0</p></section>
<section id="dialog" class="panel dialog" role="dialog" aria-label="Local teaching page review" aria-modal="false" hidden></section>
<section class="panel"><div class="section-head"><h2>Session outcome</h2><span id="provenance" class="tag">No worker selected</span></div><p id="outcome">Awaiting a result message.</p><p id="dialog-status" class="muted">No dialog observed.</p><div class="inspect-grid"><article><p class="eyebrow">ACCUMULATED USAGE</p><p id="usage">Not inspected.</p></article><article><p class="eyebrow">CONTEXT SNAPSHOT</p><p id="context">Not inspected.</p></article></div><p class="muted">Inspect sends control requests and can reopen suspended delivery. Usage and context are separate observations. Practice values are synthetic.</p></section>
<section class="panel"><div class="section-head"><h2>Delivered message audit</h2><span id="drops" class="tag">No drop counts</span></div><p class="muted">The host status poll above continues independently of SSE. Durable messages catch up after reconnect; ephemeral updates sent while suspended are lost. Latest 100 received messages retained.</p><div id="events" class="events"></div></section></div></div></section>
<section id="guide" class="view" hidden><div class="guide-grid">${GUIDE.map(([title, text]) => `<article class="panel"><p class="eyebrow">HOST CONTRACT</p><h2>${title}</h2><p>${text}</p></article>`).join('')}</div><article class="panel"><h2>The concrete browser API</h2><pre>import { query, suspendSseStream, resumeSseStream }
  from '@anthropic-ai/claude-agent-sdk/browser';

const q = query({
  prompt: messageStream,
  sse: { streamUrl, sendUrl, sessionId },
  supportedDialogKinds: ['lesson_page_review'],
  onUserDialog: renderLessonDialog,
});
await q.initializationResult();
// Keep q; event delivery and query execution have distinct lifecycles.
suspendSseStream(q);
resumeSseStream(q);
await q.getContextUsage({ detail: 'summary' });
await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();</pre><p>The source guide uses conceptual shorthand. The pinned SDK requires a transport and async iterable prompt, and its usage API is explicitly experimental. The local bridge implements only initialize, one fixed task, the teaching dialog, usage, context and cleanup. It is not an Anthropic hosted-session service.</p></article></section>
<section id="quiz" class="view" hidden><div class="quiz-wrap"><p class="eyebrow">CHECK YOUR MENTAL MODEL</p><h2>Can you explain what kept running?</h2>${QUIZ.map((q, i) => `<fieldset class="panel"><legend>${i + 1}. ${q.question}</legend>${q.answers.map((a, j) => `<label class="check"><input type="radio" name="q${i}" value="${j}">${a}</label>`).join('')}</fieldset>`).join('')}<button id="grade" class="primary">Check answers</button><p id="score" role="status"></p></div></section><footer>Browser Session Lab · Lesson 8 · Host the interaction. Observe the evidence.</footer></main>`;
let epoch = 0;
let session: BrowserSession | undefined,
  id = '',
  poll: ReturnType<typeof setInterval> | undefined,
  received = 0,
  captures = 0,
  submitted: Start | undefined,
  observations: { text: string; envelope: unknown }[] = [],
  status: Status | undefined,
  usage: unknown,
  context: unknown,
  suspended = false,
  closed = false;
const notice = (s: string) => {
  $('notice').textContent = s;
};
function controls(active: boolean) {
  for (const x of ['suspend', 'resume', 'inspect', 'close'])
    $<HTMLButtonElement>(x).disabled = !active;
  for (const x of ['mode', 'advertise', 'request-dialog', 'start'])
    $<HTMLInputElement>(x).disabled = active;
}
function streamState() {
  if (!session) return;
  $('stream').textContent = suspended
    ? 'SSE suspended · worker may continue'
    : 'SSE active · retained Query';
  $('cursor').textContent = 'Delivered cursor: ' + (session.cursor() ?? 'none');
  $('drops').textContent = 'SDK drops: ' + JSON.stringify(session.drops() || {});
}
function renderStatus(s: Status) {
  status = s;
  $('worker').textContent = s.state;
  $('produced').textContent = String(s.produced);
  $('driver').textContent =
    `Browser DOM captures: ${captures} · Worker inspection calls: ${s.driverCalls}${s.mode === 'practice' ? ' (synthetic worker count)' : ''}`;
  if (s.error) notice('Host worker failed: ' + s.error);
}
async function refresh() {
  if (!id) return;
  const polledId = id;
  try {
    const r = await fetch(`/api/sessions/${id}/status`);
    if (r.ok) {
      const next = await r.json();
      if (id === polledId) renderStatus(next);
    } else notice('The server session expired or is unavailable. Close this browser session.');
  } catch {
    notice('Host status unavailable; delivery state alone cannot prove worker state.');
  }
}
async function closeSession() {
  epoch++;
  const old = id;
  closed = true;
  clearInterval(poll);
  poll = undefined;
  session?.close();
  session = undefined;
  id = '';
  if (old) await fetch(`/api/sessions/${old}`, { method: 'DELETE' }).catch(() => {});
  $('stream').textContent = 'Query closed · server cleanup requested';
  controls(false);
  notice('Session closed. Query, transport and host resources released.');
}
$('start').onclick = async () => {
  if (session) return;
  const turn = ++epoch;
  closed = false;
  controls(true);
  received = 0;
  observations = [];
  usage = undefined;
  context = undefined;
  $('events').replaceChildren();
  $('received').textContent = '0';
  $('outcome').textContent = 'Awaiting a result message.';
  $('usage').textContent = 'Not inspected.';
  $('context').textContent = 'Not inspected.';
  $('dialog-status').textContent = 'No dialog observed.';
  try {
    const snapshot = inspectFrame($<HTMLIFrameElement>('fixture'));
    captures++;
    submitted = {
      mode: $<HTMLSelectElement>('mode').value as Start['mode'],
      requestDialog: $<HTMLInputElement>('request-dialog').checked,
      snapshot,
    };
    $('snapshot').textContent = JSON.stringify(snapshot, null, 2);
    const r = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitted),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    if (turn !== epoch) {
      await fetch(`/api/sessions/${data.id}`, { method: 'DELETE' });
      return;
    }
    id = data.id;
    $('identity').textContent = id;
    $('provenance').textContent =
      submitted.mode === 'practice' ? 'SYNTHETIC WORKER OUTPUT' : 'REAL NODE SDK QUERY';
    session = connectBrowser(
      id,
      $<HTMLInputElement>('advertise').checked,
      dialogHandler($('dialog'), (s) => {
        $('dialog-status').textContent = s;
        if (s.includes('completed') || s.includes('dismissed')) {
          suspended = false;
          streamState();
        }
      }),
    );
    const retained = session;
    suspended = false;
    streamState();
    notice('Browser SDK connecting and initializing the local peer…');
    void (async () => {
      try {
        for await (const message of retained.q) {
          if (session !== retained) break;
          received++;
          $('received').textContent = String(received);
          const envelope = retained.envelope(message);
          const text = summary(message);
          observations.push({ text, envelope });
          observations = observations.slice(-100);
          const p = document.createElement('p');
          p.textContent = `${envelope ? '#' + envelope.sequence_num : 'ephemeral'} · ${text}`;
          $('events').prepend(p);
          while ($('events').childElementCount > 100) $('events').lastElementChild!.remove();
          if (message.type === 'result') {
            $('outcome').textContent =
              message.subtype === 'success' ? clean(message.result) : 'Unsuccessful SDK result';
          }
          streamState();
        }
      } catch (e) {
        if (!closed)
          notice(
            'Browser query failed: ' + clean(e instanceof Error ? e.message : 'Unknown error'),
          );
      }
    })();
    await retained.ready();
    if (closed) return;
    retained.send();
    poll = setInterval(() => void refresh(), 500);
    await refresh();
    notice(
      submitted.mode === 'practice'
        ? 'PRACTICE · Actual browser SDK and network; synthetic worker messages, dialog and metrics.'
        : 'LIVE · Actual server SDK + MCP tool. API credits apply; $0.25 budget and 90-second query cap.',
    );
  } catch (e) {
    if (turn !== epoch) return;
    const error = clean(e instanceof Error ? e.message : 'Unable to create session');
    await closeSession();
    notice('Could not start: ' + error);
  }
};
$('suspend').onclick = () => {
  if (session?.suspend()) {
    suspended = true;
    notice('SSE delivery suspended. The retained query is open; host status polling continues.');
    streamState();
  }
};
$('resume').onclick = () => {
  if (session?.resume()) {
    suspended = false;
    notice(
      'Resuming the same Query. Retained durable events can catch up; missed ephemeral frames cannot.',
    );
    streamState();
  }
};
$('inspect').onclick = async () => {
  if (!session) return;
  const retained = session;
  $<HTMLButtonElement>('inspect').disabled = true;
  try {
    suspended = false;
    streamState();
    const results = await Promise.allSettled([retained.usage(), retained.context()]);
    if (session !== retained) return;
    const u = results[0];
    if (u.status === 'fulfilled') {
      usage = u.value;
      const m = u.value as unknown as {
        session?: {
          total_cost_usd?: number;
          model_usage?: Record<string, { inputTokens?: number; outputTokens?: number }>;
        };
      };
      const models = Object.values(m.session?.model_usage || {});
      $('usage').textContent =
        `${submitted?.mode === 'practice' ? 'SYNTHETIC' : 'LIVE'} · $${(m.session?.total_cost_usd ?? 0).toFixed(6)} · input ${models.reduce((n, x) => n + (x.inputTokens || 0), 0)} / output ${models.reduce((n, x) => n + (x.outputTokens || 0), 0)} tokens`;
    } else
      $('usage').textContent =
        'Unavailable: ' + clean(u.reason instanceof Error ? u.reason.message : 'Control failed');
    const c = results[1];
    if (c.status === 'fulfilled') {
      context = c.value;
      $('context').textContent =
        `${submitted?.mode === 'practice' ? 'SYNTHETIC' : 'LIVE'} · ${c.value.totalTokens} / ${c.value.maxTokens} tokens · ${c.value.percentage.toFixed(1)}%`;
    } else
      $('context').textContent =
        'Unavailable: ' + clean(c.reason instanceof Error ? c.reason.message : 'Control failed');
    notice(
      'Usage and context requested separately on the retained Query; control sends reopen suspended delivery.',
    );
    streamState();
  } finally {
    if (session === retained) $<HTMLButtonElement>('inspect').disabled = false;
  }
};
$('close').onclick = () => void closeSession();
$('mode').onchange = () => {
  const live = $<HTMLSelectElement>('mode').value === 'live';
  $<HTMLInputElement>('request-dialog').disabled = live;
  if (live) $<HTMLInputElement>('request-dialog').checked = false;
};
$('export').onclick = () => {
  const b = new Blob(
    [
      JSON.stringify(
        {
          submitted,
          received,
          status,
          usage,
          context,
          observations,
          note: 'Practice worker output and metrics are synthetic. Latest 100 delivered messages only.',
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(b),
    a = document.createElement('a');
  a.href = url;
  a.download = 'lesson-08-observations.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]'))
  button.onclick = () => {
    for (const view of document.querySelectorAll<HTMLElement>('.view'))
      view.hidden = view.id !== button.dataset.tab;
    for (const b of document.querySelectorAll('[data-tab]'))
      b.setAttribute('aria-selected', String(b === button));
  };
$('grade').onclick = () => {
  const score = QUIZ.filter(
    (q, i) =>
      Number(
        document.querySelector<HTMLInputElement>(`input[name="q${i}"]:checked`)?.value ?? -1,
      ) === q.correct,
  ).length;
  $('score').textContent =
    `${score} / 4 correct. ${score === 4 ? 'You can separate work, delivery and host responsibilities.' : 'Review the guide and try again.'}`;
};
void fetch('/api/meta')
  .then((r) => r.json())
  .then((m) => {
    $('key').textContent = m.liveAvailable
      ? `Live configured · ${m.model}`
      : 'Practice ready · add a server-side API key for live mode.';
  })
  .catch(() => {
    $('key').textContent = 'Local configuration unavailable.';
  });
window.addEventListener('lesson-gap', () =>
  notice(
    'Catch-up gap detected: the retained event window was exceeded. This audit is incomplete; start a fresh session for a complete exercise.',
  ),
);
window.addEventListener('pagehide', () => {
  session?.close();
  clearInterval(poll);
  if (id) void fetch(`/api/sessions/${id}`, { method: 'DELETE', keepalive: true });
});
