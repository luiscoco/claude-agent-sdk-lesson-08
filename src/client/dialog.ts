import type { OnUserDialog, UserDialogResult } from '@anthropic-ai/claude-agent-sdk/browser';
import { DIALOG_KIND, clean } from '../shared/model.js';
/** Unknown kinds stay unanswered. A cancelled result is an actual user dismissal. */
export function dialogHandler(
  element: HTMLElement,
  onState: (state: string) => void,
): OnUserDialog {
  return async (request, { signal, requestId }) => {
    if (request.dialogKind !== DIALOG_KIND) {
      onState('Unknown dialog kind left unanswered');
      return null;
    }
    if (signal.aborted) return null;
    return new Promise<UserDialogResult | null>((resolve) => {
      element.replaceChildren();
      element.hidden = false;
      const title = document.createElement('h2');
      title.textContent = clean(request.payload.title) || 'Review bundled page';
      const text = document.createElement('p');
      text.textContent = clean(request.payload.description);
      const identity = document.createElement('p');
      identity.className = 'muted';
      identity.textContent = 'Local teaching dialog · ' + requestId.slice(0, 12);
      const yes = document.createElement('button');
      yes.textContent = 'Review page';
      yes.className = 'primary';
      const cancel = document.createElement('button');
      cancel.textContent = 'Dismiss dialog';
      const settle = (value: UserDialogResult | null) => {
        signal.removeEventListener('abort', aborted);
        element.replaceChildren();
        element.hidden = true;
        onState(
          value?.behavior === 'completed'
            ? 'Dialog completed'
            : value?.behavior === 'cancelled'
              ? 'Dialog dismissed'
              : 'Dialog withdrawn',
        );
        resolve(value);
      };
      const aborted = () => settle(null);
      signal.addEventListener('abort', aborted, { once: true });
      yes.onclick = () => settle({ behavior: 'completed', result: { choice: 'review' } });
      cancel.onclick = () => settle({ behavior: 'cancelled' });
      element.append(title, text, identity, yes, cancel);
      onState('Waiting for learner choice');
      yes.focus();
    });
  };
}
