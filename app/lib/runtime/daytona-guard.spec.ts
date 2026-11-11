import { describe, expect, it } from 'vitest';
import {
  DAYTONA_MAX_REQUEST_BYTES,
  isDaytonaGuestPreviewEnabled,
  isExactSameOrigin,
  readJsonBodyWithLimit,
} from './daytona-guard';

describe('Daytona runtime request guard', () => {
  it('requires an explicit Preview-only opt-in', () => {
    expect(isDaytonaGuestPreviewEnabled('preview', 'true')).toBe(true);
    expect(isDaytonaGuestPreviewEnabled('production', 'true')).toBe(false);
    expect(isDaytonaGuestPreviewEnabled('development', 'true')).toBe(false);
    expect(isDaytonaGuestPreviewEnabled('preview', undefined)).toBe(false);
  });

  it('requires an exact same-origin request', () => {
    expect(isExactSameOrigin('https://beamcore.example', 'https://beamcore.example/api/daytona')).toBe(true);
    expect(isExactSameOrigin('http://beamcore.example', 'https://beamcore.example/api/daytona')).toBe(false);
    expect(isExactSameOrigin('https://evil.example', 'https://beamcore.example/api/daytona')).toBe(false);
    expect(isExactSameOrigin(null, 'https://beamcore.example/api/daytona')).toBe(false);
    expect(isExactSameOrigin('not a url', 'https://beamcore.example/api/daytona')).toBe(false);
  });

  it('accepts a bounded JSON object', async () => {
    const request = new Request('https://beamcore.example/api/daytona', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'status' }),
    });

    await expect(readJsonBodyWithLimit(request)).resolves.toEqual({
      ok: true,
      body: { op: 'status' },
    });
  });

  it('rejects non-JSON bodies and oversized bodies', async () => {
    const wrongType = new Request('https://beamcore.example/api/daytona', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    });
    const oversized = new Request('https://beamcore.example/api/daytona', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: 'x'.repeat(DAYTONA_MAX_REQUEST_BYTES + 1) }),
    });

    await expect(readJsonBodyWithLimit(wrongType)).resolves.toMatchObject({ ok: false, status: 415 });
    await expect(readJsonBodyWithLimit(oversized)).resolves.toMatchObject({ ok: false, status: 413 });
  });

  it('rejects arrays and malformed JSON', async () => {
    const arrayRequest = new Request('https://beamcore.example/api/daytona', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    });
    const malformedRequest = new Request('https://beamcore.example/api/daytona', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    await expect(readJsonBodyWithLimit(arrayRequest)).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(readJsonBodyWithLimit(malformedRequest)).resolves.toMatchObject({ ok: false, status: 400 });
  });
});
