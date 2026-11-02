import { SnapshotSchema, type Snapshot } from '../shared/model.js';
/** Host-owned, read-only DOM adapter for one bundled same-origin page. */
export function inspectFrame(frame: HTMLIFrameElement): Snapshot {
  const doc = frame.contentDocument;
  if (!doc || !doc.querySelector('h1')) throw Error('The bundled page has not loaded yet.');
  return SnapshotSchema.parse({
    title: doc.title.slice(0, 160),
    headings: [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].slice(0, 20).map((e) => ({
      level: Number(e.tagName[1]),
      text: (e.textContent || '').trim().slice(0, 180),
    })),
    links: [...doc.querySelectorAll('a')].slice(0, 20).map((e) => ({
      text: (e.textContent || '').trim().slice(0, 180),
      href: (e.getAttribute('href') || '').slice(0, 200),
    })),
    images: [...doc.querySelectorAll('img')]
      .slice(0, 20)
      .map((e) => ({ alt: (e.getAttribute('alt') || '').slice(0, 180) })),
  });
}
