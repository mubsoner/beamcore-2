export const DAYTONA_MAX_REQUEST_BYTES = 3_000_000;

export function isDaytonaGuestPreviewEnabled(vercelEnv?: string, explicitOptIn?: string) {
  return vercelEnv === 'preview' && explicitOptIn === 'true';
}

/**
 * This is a CSRF boundary, not user authentication. Guest runtime use is
 * only allowed on an access-protected Vercel Preview deployment.
 */
export function isExactSameOrigin(origin: string | null, requestUrl: string) {
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

export async function readJsonBodyWithLimit(
  request: Request,
  maxBytes = DAYTONA_MAX_REQUEST_BYTES,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: 400 | 413 | 415; error: string }> {
  const contentType = request.headers.get('content-type') || '';

  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return { ok: false, status: 415, error: 'Content-Type must be application/json.' };
  }

  const declaredLength = Number(request.headers.get('content-length'));

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, error: 'Request body is too large.' };
  }

  if (!request.body) {
    return { ok: false, status: 400, error: 'Request body must be valid JSON.' };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: 'Request body is too large.' };
      }

      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: 'Request body could not be read.' };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: 'Request body must be a JSON object.' };
    }

    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: 'Request body must be valid JSON.' };
  }
}
