import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalStore } from './terminal';
import type { ITerminal } from '~/types/terminal';

const mocks = vi.hoisted(() => ({
  ensureDaytonaSession: vi.fn(),
  executeDaytonaCommand: vi.fn(),
  remotePreviewSet: vi.fn(),
  webcontainerSpawn: vi.fn(),
}));

vi.mock('~/lib/daytona.client', () => ({
  ensureDaytonaSession: mocks.ensureDaytonaSession,
  executeDaytonaCommand: mocks.executeDaytonaCommand,
  remotePreviewStore: { set: mocks.remotePreviewSet },
}));

vi.mock('~/lib/webcontainer', () => ({
  webcontainer: Promise.resolve({ spawn: mocks.webcontainerSpawn }),
}));

describe('TerminalStore runtime fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('connects the terminal to WebContainer when Daytona credentials are unavailable', async () => {
    mocks.ensureDaytonaSession.mockRejectedValue(new Error('DAYTONA_API_KEY is missing'));

    const writer = {
      write: vi.fn(async () => undefined),
      releaseLock: vi.fn(),
    };
    const output = new ReadableStream<string>({
      start(controller) {
        controller.close();
      },
    });
    mocks.webcontainerSpawn.mockResolvedValue({
      input: { getWriter: () => writer },
      output,
      exit: new Promise<number>(() => undefined),
    });

    let onData: ((data: string) => void) | undefined;
    const terminal: ITerminal = {
      reset: vi.fn(),
      write: vi.fn(),
      onData: vi.fn((callback) => {
        onData = callback;
      }),
    };

    await new TerminalStore().attachTerminal(terminal);

    expect(mocks.webcontainerSpawn).toHaveBeenCalledWith('jsh');
    expect(mocks.remotePreviewSet).toHaveBeenCalledWith(undefined);
    expect(terminal.write).toHaveBeenCalledWith(
      expect.stringContaining('Connected to browser WebContainer runtime.'),
    );

    onData?.('l');
    expect(writer.write).toHaveBeenCalledWith('l');
  });
});
