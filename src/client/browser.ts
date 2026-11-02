import './process-shim.js';
import {
  query,
  suspendSseStream,
  resumeSseStream,
  getSseLastSequenceNum,
  getSseDropCounts,
  getCcrEvent,
  type OnUserDialog,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk/browser';
import { InputQueue } from '../server/input.js';
import { DIALOG_KIND, FIXED_PROMPT } from '../shared/model.js';
export function connectBrowser(id: string, advertise: boolean, onUserDialog: OnUserDialog) {
  const input = new InputQueue<SDKUserMessage>();
  const controller = new AbortController();
  // This is the installed browser SDK, not an application reimplementation.
  const q = query({
    prompt: input,
    abortController: controller,
    sse: {
      streamUrl: `${location.origin}/api/sessions/${id}/stream`,
      sendUrl: `${location.origin}/api/sessions/${id}/events`,
      sessionId: id,
      onCatchUpTruncated: () => window.dispatchEvent(new Event('lesson-gap')),
    },
    supportedDialogKinds: advertise ? [DIALOG_KIND] : [],
    onUserDialog,
  });
  return {
    q,
    ready: () => q.initializationResult(),
    send() {
      input.push({
        type: 'user',
        session_id: id,
        parent_tool_use_id: null,
        uuid: crypto.randomUUID(),
        message: { role: 'user', content: FIXED_PROMPT },
      });
    },
    suspend: () => suspendSseStream(q),
    resume: () => resumeSseStream(q),
    cursor: () => getSseLastSequenceNum(q),
    drops: () => getSseDropCounts(q),
    envelope: (m: SDKMessage) => getCcrEvent(q, m),
    async usage() {
      return q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    },
    async context() {
      return q.getContextUsage({ detail: 'summary' });
    },
    close() {
      input.close();
      q.close();
      controller.abort();
    },
  };
}
export type BrowserSession = ReturnType<typeof connectBrowser>;
