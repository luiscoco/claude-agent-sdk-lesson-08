# Live verification

Verified locally on **2026-11-02** with Node **24.21.0**, installed SDK **0.3.310**, Chrome through Playwright, and API-accessible model **claude-haiku-5-5**. Credentials remained in the ignored local `.env` and were not exposed to the browser or repository.

The browser used the actual `/browser` query API to initialize the local teaching bridge and send its fixed task. The host captured the bundled iframe DOM; a real Node SDK query called the read-only MCP `inspect_page` handler **once**, then returned three observations about headings, link text and empty image alt text. The response distinguished snapshot evidence from assumptions about page purpose. No browser page errors were reported.

An initial live run exposed a race: the host announced completion while the underlying Node iterator was still closing, allowing a browser inspection to issue controls against the closing query. The corrected implementation waits for cleanup before publishing completed worker state and serves final cached instrumentation snapshots. The subsequent real run returned:

| Observation                        | Value                    |
| ---------------------------------- | ------------------------ |
| Browser DOM captures               | 1                        |
| Actual MCP inspection calls        | 1                        |
| Final worker state                 | completed                |
| Accumulated cost (rounded display) | $0.000598                |
| Ordinary input tokens              | 1,223                    |
| Output tokens                      | 852                      |
| Summary context occupancy          | 1,613 / 1,000,000 tokens |
| Browser page errors                | 0                        |

Cost and counts are one observation, not a promise for other models or runs. Cache-specific token categories are not displayed. Context breakdown comes from `getContextUsage({detail:'summary'})`; the UI derives its display percentage from total/max counts rather than assuming a unit for the raw field. The exact 0.3.310 experimental usage method was called; no invented `getUsage()` alias was used.

Practice verification separately exercised the real browser SDK's `suspendSseStream` and `resumeSseStream`, the advertised custom teaching dialog, durable catch-up and synthetic instrumentation. Those checks establish transport/host behavior with a synthetic peer, not model behavior or an Anthropic hosted-service integration. This repository implements a deliberately narrow local teaching bridge.
