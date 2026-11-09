import type { WebContainer } from '@webcontainer/api';
import { atom } from 'nanostores';

export interface PreviewInfo {
  port: number;
  ready: boolean;
  baseUrl: string;
}

/** Shared by the Workbench preview listener and ActionRunner server-ready events. */
export const previewStore = atom<PreviewInfo[]>([]);

export function registerWebContainerPreview(port: number, baseUrl: string) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return false;
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    return false;
  }

  const existing = previewStore.get().filter((preview) => preview.port !== port);
  previewStore.set([...existing, { port, ready: true, baseUrl: parsedUrl.toString() }]);

  return true;
}

export class PreviewsStore {
  #availablePreviews = new Map<number, PreviewInfo>();
  #webcontainer: Promise<WebContainer>;

  previews = previewStore;

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;
    this.#init();
  }

  async #init() {
    const webcontainer = await this.#webcontainer;

    webcontainer.on('port', (port, type, url) => {
      let previewInfo = this.#availablePreviews.get(port);

      if (type === 'close') {
        this.#availablePreviews.delete(port);
        this.previews.set(this.previews.get().filter((preview) => preview.port !== port));
        return;
      }

      if (!previewInfo) {
        previewInfo = this.previews.get().find((preview) => preview.port === port) ?? {
          port,
          ready: type === 'open',
          baseUrl: url,
        };
        this.#availablePreviews.set(port, previewInfo);
      }

      previewInfo.ready = type === 'open';
      previewInfo.baseUrl = url;
      this.previews.set([...this.previews.get().filter((preview) => preview.port !== port), previewInfo]);
    });
  }
}
