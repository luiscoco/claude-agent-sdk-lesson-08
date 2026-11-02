# Classroom walkthrough

Allow 20 minutes. Practice requires no account, credit or API key.

1. **Identify the host:** Read the bundled page, then create a practice session. Expand the DOM snapshot. Which data came from a real DOM read? Which subsequent messages are explicitly synthetic?
2. **Retain the query:** Disable the teaching dialog, create a session, and record its query identity. Suspend SSE during work. Compare produced events, yielded messages and the independently polled worker state. Delivery can pause without cancelling the query.
3. **Resume delivery:** Wait until the worker finishes, then resume the same query. Explain why the result was absent until resume. Durable events replay; missed ephemeral text deltas do not. The delivered sequence cursor can skip control-event numbers.
4. **Control requests are sends:** Suspend again, then inspect usage and context. The SDK reopens delivery to send controls. A suspended label must not remain on the host UI after it does so.
5. **Render a dialog:** Close the session, enable the teaching dialog and create a new session. At the dialog, observe waiting worker state. Choose Review page. Repeat with Dismiss dialog and compare explicit completion with dismissal.
6. **Advertise capabilities:** Close and create another session with the dialog kind unadvertised. The practice worker skips that dialog. A callback alone is not an advertisement. Unknown kinds should remain unanswered, not be treated as a user's dismissal.
7. **Inspect observability:** Compare accumulated cost/tokens and current context occupancy. Practice numbers are synthetic. In live mode they come from separate real SDK methods; an unavailable metric does not convert the task outcome to success or failure.
8. **Live comparison (optional):** Configure your own ignored `.env`, select live mode and create a session. The actual MCP tool should inspect the captured snapshot once. The final explanation must distinguish observable heading/link/alt data from assumptions about page purpose. Inspect usage after completion; the host serves its final snapshots cached before cleanup.
9. **Close deliberately:** Close the session. Explain why closing a delivery stream is different from closing the Query and deleting server resources. Complete the four-question knowledge check.

## Small extension exercise

Add a display-only count of heading levels to the host snapshot panel. Keep it local and read-only. Add a test for a page with no headings. Do not add a general navigation or mutation tool to implement a counting exercise.

## Instructor answers

- The host owns page inspection, UI, credentials, stream lifecycle and cleanup.
- `supportedDialogKinds` plus a capable `onUserDialog` callback opts into a dialog kind.
- Suspension pauses SSE delivery. It does not stop work or billing; a worker can separately wait on a dialog or permission response.
- Resume uses the retained Query so transport/session identity stays consistent.
- Usage totals are not a measure of current context occupancy. The actual 0.3.310 usage method is experimental and has a longer name than the slide shorthand.
- Unknown dialogs remain unanswered. A recognized dialog's `cancelled` response means a learner explicitly dismissed it.
- Practice uses an actual browser SDK/network connection, but synthetic worker output and metrics.
