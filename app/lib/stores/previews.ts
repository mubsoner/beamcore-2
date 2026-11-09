import type { WebContainer } from '@webcontainer/api';
import { atom } from 'nanostores';

export interface PreviewInfo {
  port: number;
  ready: boolean;
  baseUrl: string;
}

// A singleton atom lets runtime server-ready events and WebContainer port
// events converge on the same state consumed by the Preview component.
const previews = atom<PreviewInfo[]>([]);

export function registerWebContainerPreview(port: number, baseUrl: string) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !baseUrl) {
    return;
  }

  const existing = previews.get().filter((preview) => preview.port !== port);
  previews.set([...existing, { port, ready: true, baseUrl }]);
}

export class PreviewsStore {
  #availablePreviews = new Map<number, PreviewInfo>();
  #webcontainer: Promise<WebContainer>;

  previews = previews;

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
