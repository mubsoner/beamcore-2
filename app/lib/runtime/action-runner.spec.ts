import type { WebContainer } from '@webcontainer/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionRunner } from './action-runner';
import { remotePreviewStore } from '~/lib/daytona.client';
import { PreviewsStore, previewStore } from '~/lib/stores/previews';
import { WEB_CONTAINER_STARTUP_TIMEOUT_MS } from '~/lib/webcontainer/support';

vi.mock('~/lib/daytona.client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/daytona.client')>();
  const { atom } = await import('nanostores');

  return {
    ...actual,
    // Keep the store available to both ActionRunner and this test even if
    // the mocked Daytona module is partially initialized by Vitest.
    remotePreviewStore: actual.remotePreviewStore ?? atom<{ port: number; ready: boolean; baseUrl: string } | undefined>(undefined),
    writeDaytonaFile: vi.fn(async () => {
      throw new Error('DAYTONA_API_KEY is missing');
    }),
  };
});

describe('ActionRunner WebContainer fallback', () => {
  beforeEach(() => {
    previewStore.set([]);
    remotePreviewStore.set(undefined);
  });

  it('writes generated files, starts the server, and publishes server-ready to the Workbench preview store', async () => {
    let serverReady: ((port: number, url: string) => void) | undefined;
    const fileWrites: Array<[string, string]> = [];
    const process = {
      output: new ReadableStream<string>({ start(controller) { controller.close(); } }),
      input: {
        getWriter: () => ({
          write: vi.fn(async () => serverReady?.(5173, 'https://webcontainer.example.test/')),
          releaseLock: vi.fn(),
        }),
      },
      exit: new Promise<number>(() => undefined),
      kill: vi.fn(),
    };
    const webcontainer = {
      fs: {
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async (path: string, content: string) => { fileWrites.push([path, content]); }),
      },
      spawn: vi.fn(async () => process),
      on: vi.fn((_event: string, callback: (port: number, url: string) => void) => {
        serverReady = callback;
        return vi.fn();
      }),
    } as unknown as WebContainer;

    const workbenchPreviews = new PreviewsStore(Promise.resolve(webcontainer)).previews;
    remotePreviewStore.set({ port: 3000, ready: true, baseUrl: 'https://stale-daytona.example.test/' });
    const runner = new ActionRunner(Promise.resolve(webcontainer));
    const fileAction = {
      artifactId: 'build',
      messageId: 'build',
      actionId: 'file-0',
      action: { type: 'file' as const, filePath: 'src/index.html', content: '<h1>BeamCore</h1>' },
    };
    const serverAction = {
      artifactId: 'build',
      messageId: 'build',
      actionId: 'shell-1',
      action: { type: 'shell' as const, content: 'npm run dev -- --host 0.0.0.0' },
    };

    runner.addAction(fileAction);
    await runner.runAction(fileAction);
    await vi.waitFor(() => expect(runner.actions.get()['file-0'].status).toBe('complete'));

    runner.addAction(serverAction);
    await runner.runAction(serverAction);
    await vi.waitFor(() => expect(runner.actions.get()['shell-1'].status).toBe('complete'));

    expect(fileWrites).toEqual([['src/index.html', '<h1>BeamCore</h1>']]);
    expect(webcontainer.spawn).toHaveBeenCalledWith('jsh');
    expect(workbenchPreviews.get()).toEqual([
      { port: 5173, ready: true, baseUrl: 'https://webcontainer.example.test/' },
    ]);
    expect(remotePreviewStore.get()).toBeUndefined();
  });

  it('marks a file action failed when WebContainer startup never resolves and Daytona is unavailable', async () => {
    vi.useFakeTimers();

    try {
      const unavailableWebContainer = new Promise<WebContainer>(() => undefined);
      const runner = new ActionRunner(unavailableWebContainer);
      const fileAction = {
        artifactId: 'build-timeout',
        messageId: 'build-timeout',
        actionId: 'file-timeout',
        action: { type: 'file' as const, filePath: 'index.html', content: '<h1>BeamCore</h1>' },
      };

      runner.addAction(fileAction);
      await runner.runAction(fileAction);
      await vi.advanceTimersByTimeAsync(WEB_CONTAINER_STARTUP_TIMEOUT_MS + 1);
      await Promise.resolve();
      await Promise.resolve();

      const failedAction = runner.actions.get()['file-timeout'];
      expect(failedAction.status).toBe('failed');

      if (failedAction.status === 'failed') {
        expect(failedAction.error).toContain('did not finish starting within 60 seconds');
        expect(failedAction.error).toContain('DAYTONA_API_KEY is missing');
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
