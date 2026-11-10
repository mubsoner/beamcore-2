import { WebContainer } from '@webcontainer/api';
import { map, type MapStore } from 'nanostores';
import * as nodePath from 'node:path';
import type { BoltAction } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { WORK_DIR } from '~/utils/constants';
import { executeDaytonaCommand, remotePreviewStore, syncDaytonaFiles, writeDaytonaFile, type DaytonaSyncFile } from '~/lib/daytona.client';
import type { FileMap } from '~/lib/stores/files';
import { registerWebContainerPreview } from '~/lib/stores/previews';
import { getWebContainerCookieHelp, WEB_CONTAINER_STARTUP_TIMEOUT_MS } from '~/lib/webcontainer/support';
import { unreachable } from '~/utils/unreachable';
import type { ActionCallbackData } from './message-parser';
import { getProjectPreviewPort, isDaytonaUnavailableError, isDevServerCommand, normalizeProjectPath } from './command-utils';

const logger = createScopedLogger('ActionRunner');

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
  output?: string;
};

export type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = BaseActionState | FailedActionState;

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed' | 'output'>>;

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #getFiles: () => FileMap;
  #onFileSaved?: (path: string, content: string) => void;
  #daytonaUnavailableReason?: string;
  #currentExecutionPromise: Promise<void> = Promise.resolve();

  actions: ActionsMap = map({});

  constructor(
    webcontainerPromise: Promise<WebContainer>,
    getFiles: () => FileMap = () => ({}),
    onFileSaved?: (path: string, content: string) => void,
  ) {
    this.#webcontainer = webcontainerPromise;
    this.#getFiles = getFiles;
    this.#onFileSaved = onFileSaved;

    void this.#webcontainer.catch((error) => {
      logger.warn('Browser WebContainer is unavailable; Daytona remains the primary runtime.', error);
    });
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;
    const actions = this.actions.get();

    if (actions[actionId]) {
      return;
    }

    const abortController = new AbortController();

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.#updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });
  }

  async runAction(data: ActionCallbackData) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable('Action ' + actionId + ' not found');
    }

    if (action.executed) {
      return;
    }

    this.#updateAction(actionId, { ...action, ...data.action, executed: true });

    // Keep all action types in one queue: file writes must finish before the
    // following install/start command can observe the project on either runtime.
    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => this.#executeAction(actionId))
      .catch((error) => {
        // #executeAction records the failure on the action. Recover the queue so
        // later actions still run, while retaining the visible failed status.
        console.error('[BeamCore] Action execution failed:', error);
      });
  }

  async #executeAction(actionId: string) {
    const action = this.actions.get()[actionId];
    this.#updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'shell': {
          const result = await this.#runShellAction(action);
          this.#updateAction(actionId, { output: result.output });
          break;
        }
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
      }

      this.#updateAction(actionId, { status: action.abortSignal.aborted ? 'aborted' : 'complete' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#updateAction(actionId, { status: 'failed', error: message });
      throw error;
    }
  }

  async #runShellAction(action: ActionState) {
    if (action.type !== 'shell') {
      unreachable('Expected shell action');
    }

    if (action.abortSignal.aborted) {
      throw new Error('Command was cancelled before execution.');
    }

    // Daytona is the primary runtime. Only infrastructure/credential failures
    // trigger the optional browser fallback; ordinary command errors stay visible.
    if (this.#daytonaUnavailableReason) {
      remotePreviewStore.set(undefined);
      return this.#runWebContainerCommand(action.content);
    }

    try {
      const files: DaytonaSyncFile[] = [];
      let totalBytes = 0;

      for (const [absolutePath, entry] of Object.entries(this.#getFiles())) {
        if (entry?.type !== 'file' || entry.isBinary) continue;

        const relativePath = nodePath.posix.relative(WORK_DIR, absolutePath.replace(/\\\\/g, '/'));
        if (!relativePath || relativePath === '.' || relativePath === '..' || relativePath.startsWith('../') ||
          /(^|\\/)(?:node_modules|\\.git|\\.cache|dist|build)(\\/|$)/.test(relativePath)) continue;

        const bytes = new TextEncoder().encode(entry.content).byteLength;
        if (files.length >= 300 || totalBytes + bytes > 2_000_000) {
          throw new Error('Generated project exceeds the 300-file / 2 MB Daytona sync limit.');
        }
        totalBytes += bytes;
        files.push({ path: relativePath, content: entry.content });
      }

      if (files.length > 0) await syncDaytonaFiles(files);
      const result = await executeDaytonaCommand(\n        action.content,\n        isDevServerCommand(action.content) ? getProjectPreviewPort(action.content, this.#getFiles()) : undefined,\n      );
      const output = result.output || '';

      if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
        throw new Error('Daytona command failed with exit code ' + result.exitCode + '.\\n' + output);
      }

      if (result.preview) remotePreviewStore.set(result.preview);
      logger.info('Command completed in Daytona sandbox.');
      return { output };
    } catch (error) {
      if (!isDaytonaUnavailableError(error)) throw error;

      this.#daytonaUnavailableReason = error instanceof Error ? error.message : String(error);
      remotePreviewStore.set(undefined);
      logger.warn('Daytona is unavailable; falling back to browser WebContainer.', error);
      return this.#runWebContainerCommand(action.content);
    }
  }

  async #runWebContainerCommand(command: string) {
    const webcontainer = await withTimeout(
      this.#webcontainer,
      WEB_CONTAINER_STARTUP_TIMEOUT_MS,
      'The browser WebContainer runtime did not finish starting within 60 seconds. ' + getWebContainerCookieHelp(),
    );
    const isDevServer = isDevServerCommand(command);
    const process = await webcontainer.spawn('jsh');
    let output = '';

    const outputFinished = process.output.pipeTo(new WritableStream<string>({
      write(chunk) {
        output += chunk;
      },
    })).catch((error) => {
      logger.warn('Could not capture all WebContainer command output.', error);
    });

    let serverReadyPromise: Promise<{ port: number; url: string }> | undefined;

    if (isDevServer) {
      serverReadyPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          dispose();
          process.kill();
          reject(new Error('WebContainer started the dev command but no preview server became ready within 45 seconds.'));
        }, 45_000);

        const dispose = webcontainer.on('server-ready', (port, url) => {
          clearTimeout(timeout);
          dispose();
          registerWebContainerPreview(port, url);
          resolve({ port, url });
        });
      });
    }

    const input = process.input.getWriter();

    try {
      await input.write(isDevServer ? command + '\n' : command + '\nexit\n');
    } finally {
      input.releaseLock();
    }

    if (serverReadyPromise) {
      const server = await serverReadyPromise;
      logger.info('WebContainer Preview is ready on port ' + server.port + ': ' + server.url);
      return { output: (output ? output + '\n' : '') + 'WebContainer Preview ready: ' + server.url };
    }

    const exitCode = await process.exit;
    await outputFinished;

    if (exitCode !== 0) {
      throw new Error('WebContainer command failed with exit code ' + exitCode + '.\n' + output);
    }

    logger.info('Command completed in browser WebContainer.');
    return { output };
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const safePath = normalizeProjectPath(action.filePath);
    let remoteSaved = false;
    let browserSaved = false;
    let remoteError: unknown;

    // Save to Daytona first so the editor and Preview share one authoritative project.
    if (!this.#daytonaUnavailableReason) {
      try {
        await writeDaytonaFile(safePath, action.content);
        remoteSaved = true;
      } catch (error) {
        remoteError = error;
        if (!isDaytonaUnavailableError(error)) throw error;
        this.#daytonaUnavailableReason = error instanceof Error ? error.message : String(error);
        remotePreviewStore.set(undefined);
        logger.warn('Daytona file write unavailable; trying browser fallback.', error);
      }
    }

    // Browser storage is an optional mirror/fallback, never a prerequisite for Daytona.
    try {
      const webcontainer = await withTimeout(
        this.#webcontainer,
        WEB_CONTAINER_STARTUP_TIMEOUT_MS,
        'The browser WebContainer runtime did not finish starting within 60 seconds. ' + getWebContainerCookieHelp(),
      );
      const folder = nodePath.posix.dirname(safePath);
      if (folder !== '.') await webcontainer.fs.mkdir(folder, { recursive: true });
      await webcontainer.fs.writeFile(safePath, action.content);
      browserSaved = true;
    } catch (error) {
      logger.warn('Optional browser file mirror is unavailable: ' + safePath, error);
    }

    if (remoteSaved || browserSaved) this.#onFileSaved?.(safePath, action.content);

    if (!remoteSaved && !browserSaved) {
      const remoteDetail = remoteError instanceof Error ? remoteError.message : String(remoteError || 'unavailable');
      throw new Error('Could not save ' + safePath + '. Daytona: ' + remoteDetail + '. Browser runtime is unavailable.');
    }
  }

  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();
    this.actions.setKey(id, { ...actions[id], ...newState });
  }
}
