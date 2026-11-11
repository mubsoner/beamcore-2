import { describe, expect, it } from 'vitest';
import { getWebContainerSupportIssues, WEB_CONTAINER_STARTUP_TIMEOUT_MS } from './support';

describe('WebContainer browser prerequisites', () => {
  it('accepts a secure, cross-origin-isolated browser with SharedArrayBuffer and Service Workers', () => {
    expect(getWebContainerSupportIssues({
      secureContext: true,
      crossOriginIsolated: true,
      sharedArrayBuffer: true,
      serviceWorker: true,
    })).toEqual([]);
  });

  it('reports missing secure context, isolation, shared memory, and service-worker support', () => {
    expect(getWebContainerSupportIssues({
      secureContext: false,
      crossOriginIsolated: false,
      sharedArrayBuffer: false,
      serviceWorker: false,
    })).toEqual([
      'BeamCore must be opened over HTTPS or localhost (a secure browser context).',
      'The page is not cross-origin isolated. The response must include COOP: same-origin and COEP: require-corp.',
      'SharedArrayBuffer is unavailable. Check cross-origin isolation and browser support.',
      'This browser context does not expose Service Workers, which WebContainers need for project previews.',
    ]);
  });

  it('allows a longer bounded boot period for slower browsers', () => {
    expect(WEB_CONTAINER_STARTUP_TIMEOUT_MS).toBe(60_000);
  });
});
