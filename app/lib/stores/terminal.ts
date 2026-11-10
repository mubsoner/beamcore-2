import { atom, type WritableAtom } from 'nanostores';
import type { ITerminal } from '~/types/terminal';
import { executeDaytonaCommand, ensureDaytonaSession, remotePreviewStore } from '~/lib/daytona.client';
import { webcontainer } from '~/lib/webcontainer';
import { coloredText } from '~/utils/terminal';

function withRuntimeTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('WebContainer did not finish starting within 20 seconds. Check browser support and cross-origin isolation.')),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export class TerminalStore {
  showTerminal: WritableAtom<boolean> = import.meta.hot?.data.showTerminal ?? atom(false);

  constructor() {
    if (import.meta.hot) {
      import.meta.hot.data.showTerminal = this.showTerminal;
    }
  }

  toggleTerminal(value?: boolean) {
    this.showTerminal.set(value !== undefined ? value : !this.showTerminal.get());
  }

  async attachTerminal(terminal: ITerminal) {
    terminal.reset();
    terminal.write(coloredText.green('BeamCore project terminal\\r\\n'));
    terminal.write('Connecting to your project runtime...\\r\\n');

    try {
      await ensureDaytonaSession();
      terminal.write(coloredText.green('Connected to Daytona sandbox.\\r\\n'));
      this.#attachDaytonaTerminal(terminal);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      remotePreviewStore.set(undefined);
      terminal.write(coloredText.yellow('Daytona unavailable: ' + detail + '\\r\\n'));
      terminal.write('Switching to the browser WebContainer runtime...\\r\\n');
    }

    try {
      const container = await withRuntimeTimeout(webcontainer, 20_000);
      const process = await container.spawn('jsh');
      const writer = process.input.getWriter();

      terminal.write(coloredText.green('Connected to browser WebContainer runtime.\\r\\n'));
      terminal.write('Commands run inside this browser workspace.\\r\\n');

      void process.output
        .pipeTo(new WritableStream<string>({
          write(chunk) {
            terminal.write(chunk);
          },
        }))
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          terminal.write(coloredText.red('WebContainer output stream failed: ' + detail + '\\r\\n'));
        });

      terminal.onData((data) => {
        void writer.write(data).catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          terminal.write(coloredText.red('Could not send input to WebContainer: ' + detail + '\\r\\n'));
        });
      });

      void process.exit.then((exitCode) => {
        terminal.write('\\r\\nWebContainer terminal process exited with code ' + exitCode + '.\\r\\n');
      }).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        terminal.write(coloredText.red('WebContainer terminal stopped: ' + detail + '\\r\\n'));
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      terminal.write(coloredText.red('Browser runtime is also unavailable: ' + detail + '\\r\\n'));
      terminal.write('Project actions cannot run until Daytona or WebContainer is available.\\r\\n');
    }
  }

  #attachDaytonaTerminal(terminal: ITerminal) {
    let commandBuffer = '';
    let running = false;
    const writePrompt = () => terminal.write('\\r\\n$ ');

    writePrompt();

    terminal.onData((data) => {
      if (data === '\\u0003') {
        commandBuffer = '';
        terminal.write('^C');
        writePrompt();
        return;
      }

      if (data === '\\r' || data === '\\n') {
        const command = commandBuffer.trim();
        commandBuffer = '';
        terminal.write('\\r\\n');

        if (!command) {
          writePrompt();
          return;
        }

        if (command === 'clear') {
          terminal.reset();
          writePrompt();
          return;
        }

        if (running) {
          terminal.write(coloredText.yellow('A command is already running.\\r\\n'));
          writePrompt();
          return;
        }

        running = true;

        void executeDaytonaCommand(command)
          .then((result) => {
            if (result.output) {
              terminal.write(result.output.replace(/\\r?\\n/g, '\\r\\n'));
              if (!result.output.endsWith('\\n')) {
                terminal.write('\\r\\n');
              }
            }

            if (result.preview) {
              remotePreviewStore.set(result.preview);
              terminal.write(coloredText.green('Live Preview: ' + result.preview.baseUrl + '\\r\\n'));
            }
          })
          .catch((error) => {
            const detail = error instanceof Error ? error.message : String(error);
            terminal.write(coloredText.red(detail + '\\r\\n'));
          })
          .finally(() => {
            running = false;
            writePrompt();
          });

        return;
      }

      if (data === '\\u007f' || data === '\\b') {
        if (commandBuffer.length > 0) {
          commandBuffer = commandBuffer.slice(0, -1);
          terminal.write('\\b \\b');
        }
        return;
      }

      if (data.length === 1 && data >= ' ' && data !== '\\u007f') {
        commandBuffer += data;
        terminal.write(data);
      }
    });
  }

  onTerminalResize(_cols: number, _rows: number) {
    // Daytona commands do not require terminal geometry.
  }
}
