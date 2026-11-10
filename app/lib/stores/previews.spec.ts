import type { WebContainer } from '@webcontainer/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewsStore, previewStore, registerWebContainerPreview } from './previews';

describe('shared preview handoff', () => {
  afterEach(() => {
    previewStore.set([]);
  });

  it('publishes a server-ready URL to the same store exposed by PreviewsStore', () => {
    const webcontainer = { on: vi.fn() } as unknown as WebContainer;
    const workbenchPreviews = new PreviewsStore(Promise.resolve(webcontainer)).previews;

    expect(registerWebContainerPreview(5173, 'https://preview.example.test/')).toBe(true);
    expect(workbenchPreviews.get()).toEqual([
      { port: 5173, ready: true, baseUrl: 'https://preview.example.test/' },
    ]);
  });

  it('updates an existing port rather than leaving a stale preview URL', () => {
    registerWebContainerPreview(5173, 'https://old.example.test');

    expect(registerWebContainerPreview(5173, 'https://new.example.test/')).toBe(true);
    expect(previewStore.get()).toEqual([
      { port: 5173, ready: true, baseUrl: 'https://new.example.test/' },
    ]);
  });

  it.each([
    [0, 'https://preview.example.test'],
    [65536, 'https://preview.example.test'],
    [5173, 'javascript:alert(1)'],
    [5173, 'not a URL'],
  ])('does not publish invalid preview data (%s, %s)', (port, url) => {
    expect(registerWebContainerPreview(port, url)).toBe(false);
    expect(previewStore.get()).toEqual([]);
  });
});
