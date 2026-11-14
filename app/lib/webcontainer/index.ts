import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME } from '~/utils/constants';
import { getCurrentWebContainerSupportIssues, getWebContainerCookieHelp } from './support';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

export let webcontainer: Promise<WebContainer> = new Promise(() => {
  // noop for ssr
});

if (!import.meta.env.SSR) {
  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve()
      .then(() => {
        const supportIssues = getCurrentWebContainerSupportIssues();

        if (supportIssues.length > 0) {
          throw new Error('WebContainer browser prerequisites are missing: ' + supportIssues.join(' '));
        }

        return WebContainer.boot({
          workdirName: WORK_DIR_NAME,
          forwardPreviewErrors: 'exceptions-only',
        });
      })
      .then((container) => {
        webcontainerContext.loaded = true;

        return container;
      })
      .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[BeamCore] WebContainer startup failed:', error);
        throw new Error(
          'The browser project runtime could not start: ' + detail + ' ' + getWebContainerCookieHelp(),
        );
      });

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}
