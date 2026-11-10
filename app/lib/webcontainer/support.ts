export interface WebContainerBrowserCapabilities {
  secureContext: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  serviceWorker: boolean;
}

export const WEB_CONTAINER_STARTUP_TIMEOUT_MS = 60_000;

export function getWebContainerSupportIssues(capabilities: WebContainerBrowserCapabilities): string[] {
  const issues: string[] = [];

  if (!capabilities.secureContext) {
    issues.push('BeamCore must be opened over HTTPS or localhost (a secure browser context).');
  }

  if (!capabilities.crossOriginIsolated) {
    issues.push('The page is not cross-origin isolated. The response must include COOP: same-origin and COEP: require-corp.');
  }

  if (!capabilities.sharedArrayBuffer) {
    issues.push('SharedArrayBuffer is unavailable. Check cross-origin isolation and browser support.');
  }

  if (!capabilities.serviceWorker) {
    issues.push('This browser context does not expose Service Workers, which WebContainers need for project previews.');
  }

  return issues;
}

export function getCurrentWebContainerSupportIssues(): string[] {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return ['WebContainer can only start in the browser.'];
  }

  return getWebContainerSupportIssues({
    secureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    serviceWorker: 'serviceWorker' in navigator,
  });
}

export function getWebContainerCookieHelp(): string {
  return [
    'WebContainers also require third-party storage and Service Workers for project domains.',
    'In Chrome, allow third-party cookies for https://[*.]stackblitz.io and https://[*.]webcontainer.io, then reload BeamCore.',
    'Close other WebContainer/StackBlitz tabs if the browser is low on memory.',
  ].join(' ');
}
