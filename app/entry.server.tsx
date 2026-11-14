import type { AppLoadContext, EntryContext } from '@remix-run/cloudflare';
import { RemixServer } from '@remix-run/react';
import { isbot } from 'isbot';
import { renderToReadableStream } from 'react-dom/server';
import { renderHeadToString } from 'remix-island';
import { Head } from './root';
import { themeStore } from '~/lib/stores/theme';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  const readable = await renderToReadableStream(<RemixServer context={remixContext} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      console.error(error);
      responseStatusCode = 500;
    },
  });

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelled = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const head = renderHeadToString({ request, remixContext, Head });

      controller.enqueue(
        new Uint8Array(
          new TextEncoder().encode(
            `<!DOCTYPE html><html lang="en" data-theme="${themeStore.value}"><head>${head}</head><body><div id="root" class="w-full h-full">`,
          ),
        ),
      );

      reader = readable.getReader();

      function read() {
        reader!
          .read()
          .then(({ done, value }) => {
            if (cancelled) {
              return;
            }

            if (done) {
              controller.enqueue(new Uint8Array(new TextEncoder().encode(`</div></body></html>`)));
              controller.close();

              return;
            }

            if (value) {
              controller.enqueue(value);
            }

            read();
          })
          .catch((error) => {
            if (!cancelled) {
              controller.error(error);
            }

            // The stream is locked by this reader, so cancellation must go
            // through reader.cancel() rather than readable.cancel().
            void reader?.cancel(error).catch(() => undefined);
          });
      }

      read();
    },

    cancel(reason) {
      cancelled = true;
      return reader?.cancel(reason).catch(() => undefined);
    },
  });

  if (isbot(request.headers.get('user-agent') || '')) {
    await readable.allReady;
  }

  responseHeaders.set('Content-Type', 'text/html');

  responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
