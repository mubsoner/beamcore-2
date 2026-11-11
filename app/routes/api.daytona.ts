import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import * as path from 'node:path';
import {
  isDaytonaGuestPreviewEnabled,
  isExactSameOrigin,
  readJsonBodyWithLimit,
} from '~/lib/runtime/daytona-guard';

const COOKIE_NAME = 'beamcore_daytona';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const TERMINAL_SESSION_ID = 'beamcore-terminal';
const MAX_SYNC_FILES = 300;
const MAX_SYNC_BYTES = 2_500_000;

type DaytonaFileInput = { path: string; content: string };

let clientPromise: Promise<any> | undefined;

async function getDaytonaClient() {
  const apiKey = process.env.DAYTONA_API_KEY;

  if (!apiKey) {
    throw new Error('DAYTONA_API_KEY is missing from this Vercel Preview deployment.');
  }

  if (!clientPromise) {
    clientPromise = import('@daytona/sdk').then(({ Daytona }) => new Daytona({ apiKey }));
    void clientPromise.catch(() => {
      clientPromise = undefined;
    });
  }

  return clientPromise;
}

function getCookieValue(request: Request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const prefix = COOKIE_NAME + '=';
  const item = cookieHeader.split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix));

  if (!item) return undefined;

  try {
    const value = decodeURIComponent(item.slice(prefix.length));
    return value.length <= 512 ? value : undefined;
  } catch {
    return undefined;
  }
}

function signSandboxId(sandboxId: string) {
  const key = process.env.DAYTONA_SESSION_SECRET;

  if (!key || key.length < 32) {
    throw new Error('DAYTONA_SESSION_SECRET must be configured as a separate server-side secret of at least 32 characters.');
  }

  return createHmac('sha256', key).update('beamcore:' + sandboxId).digest('base64url');
}

function readSandboxId(request: Request) {
  const value = getCookieValue(request);

  if (!value) {
    return undefined;
  }

  const [sandboxId, signature] = value.split('.');

  if (!sandboxId || !signature) {
    return undefined;
  }

  const expected = signSandboxId(sandboxId);
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return undefined;
  }

  return sandboxId;
}

function makeSessionCookie(sandboxId: string) {
  const value = sandboxId + '.' + signSandboxId(sandboxId);

  return COOKIE_NAME + '=' + encodeURIComponent(value) +
    '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + COOKIE_MAX_AGE;
}

function isSafeRelativePath(value: string) {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  return Boolean(
    value &&
    !path.posix.isAbsolute(value) &&
    normalized !== '.' &&
    normalized !== '..' &&
    !normalized.startsWith('../') &&
    !normalized.includes('\0'),
  );
}

async function ensureParentFolders(sandbox: any, relativePath: string) {
  const folder = path.posix.dirname(relativePath);

  if (!folder || folder === '.') {
    return;
  }

  let current = '';

  for (const segment of folder.split('/')) {
    current = current ? current + '/' + segment : segment;

    try {
      await sandbox.fs.createFolder(current, '755');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!/exist|already|409/i.test(detail)) {
        throw error;
      }
    }
  }
}

function isMissingSandboxError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return /sandbox.*(not found|does not exist|unknown)/i.test(String(error));
  }

  const value = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    message?: string;
  };

  return value.status === 404 || value.statusCode === 404 || value.response?.status === 404 ||
    /sandbox.*(not found|does not exist|unknown)/i.test(value.message || '');
}

async function createSandbox(daytona: any) {
  return daytona.create({
    language: 'typescript',
    name: 'beamcore-' + randomUUID().slice(0, 8),
    labels: { app: 'beamcore', runtime: 'preview' },
    autoStopInterval: 60,
    autoArchiveInterval: 1440,
  }, { timeout: 90 });
}

async function getOrCreateSandbox(request: Request) {
  const daytona = await getDaytonaClient();
  const existingId = readSandboxId(request);

  if (existingId) {
    try {
      const sandbox = await daytona.get(existingId);

      if (sandbox.state === 'stopped' || sandbox.state === 'paused' || sandbox.state === 'archived') {
        await sandbox.start(60);
      }

      await sandbox.refreshActivity().catch(() => undefined);

      return { daytona, sandbox, cookie: undefined as string | undefined };
    } catch (error) {
      if (!isMissingSandboxError(error)) {
        // A transient provider failure must not silently create an orphan sandbox.
        throw error;
      }
      console.warn('[BeamCore] Saved Daytona sandbox no longer exists; creating a replacement.');
    }
  }

  const sandbox = await createSandbox(daytona);
  return { daytona, sandbox, cookie: makeSessionCookie(sandbox.id) };
}

async function ensureTerminalSession(sandbox: any) {
  try {
    await sandbox.process.getSession(TERMINAL_SESSION_ID);
  } catch {
    try {
      await sandbox.process.createSession(TERMINAL_SESSION_ID);
    } catch {
      await sandbox.process.getSession(TERMINAL_SESSION_ID);
    }
  }
}

function detectDevPort(command: string, requestedPort?: number) {
  if (Number.isInteger(requestedPort) && requestedPort! >= 1024 && requestedPort! <= 65535) {
    return requestedPort!;
  }
  const explicit = command.match(/(?:--port\s+|--port=|PORT=)(\d{2,5})/i);
  if (explicit) return Number(explicit[1]);
  if (/\b(?:next\s+(?:dev|start)|react-scripts\s+start|npm\s+start)\b/i.test(command)) return 3000;
  if (/\bastro\s+dev\b/i.test(command)) return 4321;
  if (/\bvite\s+preview\b/i.test(command)) return 4173;
  return 5173;
}
function isDevServerCommand(command: string) {
  return /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|preview)\b/i.test(command);
}

function normalizeOutput(result: any) {
  return String(result?.output ?? result?.result ?? result?.stdout ?? result?.artifacts?.stdout ?? '');
}

async function getPreview(sandbox: any, port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Preview port must be between 1024 and 65535.');
  }

  const signed = await sandbox.getSignedPreviewUrl(port, 3600);

  return {
    port,
    ready: true,
    baseUrl: signed.url,
  };
}

const PREVIEW_READY_TIMEOUT_MS = 5_000;
const PREVIEW_PROBE_TIMEOUT_MS = 1_000;
const PREVIEW_POLL_INTERVAL_MS = 350;

async function getCommandLogs(sandbox: any, commandId?: string) {
  if (!commandId) return '';

  try {
    const logs = await sandbox.process.getSessionCommandLogs(TERMINAL_SESSION_ID, commandId);
    return String(logs?.output || logs?.stdout || logs?.stderr || '').slice(-4_000);
  } catch {
    return '';
  }
}

/**
 * A Daytona signed URL can be created before an application is listening.
 * Do not publish it as ready until the async command is still alive and the
 * HTTP endpoint responds. The timeout stays bounded for serverless requests.
 */
async function waitForPreview(sandbox: any, port: number, commandId?: string) {
  const signed = await sandbox.getSignedPreviewUrl(port, 3600);
  const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;
  let lastProbeError = 'The preview endpoint has not responded yet.';

  while (Date.now() < deadline) {
    if (commandId) {
      try {
        const command = await sandbox.process.getSessionCommand(TERMINAL_SESSION_ID, commandId);

        if (typeof command?.exitCode === 'number') {
          const logs = await getCommandLogs(sandbox, commandId);
          throw new Error(
            'The dev server process stopped with exit code ' + command.exitCode +
            (logs ? '.\n' + logs : '. Check the project terminal output.'),
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('dev server process stopped')) {
          throw error;
        }
        // A transient command-status lookup failure should not hide a working HTTP server.
      }
    }

    try {
      const response = await fetch(signed.url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(PREVIEW_PROBE_TIMEOUT_MS),
      });
      await response.body?.cancel().catch(() => undefined);

      if (response.status >= 200 && response.status < 500) {
        return {
          port,
          ready: true,
          baseUrl: signed.url,
        };
      }

      lastProbeError = 'The preview endpoint responded with HTTP ' + response.status + '.';
    } catch (error) {
      lastProbeError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, PREVIEW_POLL_INTERVAL_MS));
  }

  const logs = await getCommandLogs(sandbox, commandId);
  throw new Error(
    'The dev server did not become reachable on port ' + port + ' within ' +
    PREVIEW_READY_TIMEOUT_MS / 1000 + ' seconds. ' + lastProbeError +
    (logs ? '\nRecent server output:\n' + logs : ''),
  );
}

export async function action({ request }: ActionFunctionArgs) {
  // No BeamCore account-auth provider is wired into this V1 repository yet.
  // Guest execution is therefore opt-in for access-protected Vercel Preview only;
  // production execution remains disabled until INV-06 supplies a trusted principal.
  if (!isDaytonaGuestPreviewEnabled(process.env.VERCEL_ENV, process.env.DAYTONA_GUEST_PREVIEW_ENABLED)) {
    return json({
      ok: false,
      error: 'Daytona guest runtime is disabled. It may only be explicitly enabled for a non-production Vercel Preview deployment after Deployment Protection is configured; production requires authenticated user authorization.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed.' }, { status: 405 });
  }

  if (!isExactSameOrigin(request.headers.get('origin'), request.url)) {
    return json({ ok: false, error: 'A same-origin browser request is required.' }, { status: 403 });
  }

  if (!process.env.DAYTONA_SESSION_SECRET || process.env.DAYTONA_SESSION_SECRET.length < 32) {
    return json({
      ok: false,
      error: 'DAYTONA_SESSION_SECRET must be configured as a separate server-side secret of at least 32 characters.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const parsedBody = await readJsonBodyWithLimit(request);

  if (!parsedBody.ok) {
    return json({ ok: false, error: parsedBody.error }, { status: parsedBody.status });
  }

  const body = parsedBody.body;
  const op = body.op;

  if (typeof op !== 'string' || !['status', 'file', 'sync', 'command', 'preview'].includes(op)) {
    return json({ ok: false, error: 'Unsupported Daytona operation.' }, { status: 400 });
  }

  // Validate all caller-controlled input before allocating or waking a paid sandbox.
  if (op === 'file') {
    if (typeof body.path !== 'string' || typeof body.content !== 'string' ||
      !isSafeRelativePath(body.path) || Buffer.byteLength(body.content, 'utf8') > 750_000) {
      return json({ ok: false, error: 'A safe relative file path and text content under 750 KB are required.' }, { status: 400 });
    }
  }

  if (op === 'sync') {
    if (!Array.isArray(body.files) || body.files.length > MAX_SYNC_FILES) {
      return json({ ok: false, error: 'Sync accepts up to ' + MAX_SYNC_FILES + ' files.' }, { status: 400 });
    }

    let totalBytes = 0;
    for (const file of body.files as DaytonaFileInput[]) {
      if (!file || typeof file.path !== 'string' || typeof file.content !== 'string' || !isSafeRelativePath(file.path)) {
        return json({ ok: false, error: 'A sync entry contains an invalid path or content.' }, { status: 400 });
      }
      totalBytes += Buffer.byteLength(file.content, 'utf8');
      if (totalBytes > MAX_SYNC_BYTES) {
        return json({ ok: false, error: 'Project sync is larger than the 2.5 MB request limit.' }, { status: 413 });
      }
    }
  }

  if (op === 'preview') {
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return json({ ok: false, error: 'Preview port must be between 1024 and 65535.' }, { status: 400 });
    }
  }

  if (op === 'command' && (typeof body.command !== 'string' || !body.command.trim() || body.command.length > 8_000)) {
    return json({ ok: false, error: 'A command between 1 and 8,000 characters is required.' }, { status: 400 });
  }

  try {
    const { sandbox, cookie } = await getOrCreateSandbox(request);
    const headers = new Headers({ 'Cache-Control': 'no-store' });

    if (cookie) {
      headers.append('Set-Cookie', cookie);
    }

    if (op === 'status') {
      return json({ ok: true, sandboxState: sandbox.state || 'started' }, { headers });
    }

    if (op === 'file') {
      if (typeof body.path !== 'string' || typeof body.content !== 'string' || !isSafeRelativePath(body.path)) {
        return json({ ok: false, error: 'A safe relative file path and text content are required.' }, { status: 400, headers });
      }

      if (body.content.length > 750_000) {
        return json({ ok: false, error: 'The file is too large to upload in one action.' }, { status: 413, headers });
      }

      await ensureParentFolders(sandbox, body.path);
      await sandbox.fs.uploadFile(Buffer.from(body.content, 'utf8'), body.path);

      return json({ ok: true, path: path.posix.normalize(body.path) }, { headers });
    }

    if (op === 'sync') {
      if (!Array.isArray(body.files) || body.files.length > MAX_SYNC_FILES) {
        return json({ ok: false, error: 'Sync accepts up to ' + MAX_SYNC_FILES + ' files.' }, { status: 400, headers });
      }

      const files = body.files as DaytonaFileInput[];
      let totalBytes = 0;

      for (const file of files) {
        if (!file || typeof file.path !== 'string' || typeof file.content !== 'string' || !isSafeRelativePath(file.path)) {
          return json({ ok: false, error: 'A sync entry contains an invalid path or content.' }, { status: 400, headers });
        }

        totalBytes += Buffer.byteLength(file.content, 'utf8');

        if (totalBytes > MAX_SYNC_BYTES) {
          return json({ ok: false, error: 'Project sync is larger than the 2.5 MB request limit.' }, { status: 413, headers });
        }
      }

      for (const file of files) {
        await ensureParentFolders(sandbox, file.path);
        await sandbox.fs.uploadFile(Buffer.from(file.content, 'utf8'), file.path);
      }

      return json({ ok: true, filesUploaded: files.length }, { headers });
    }

    if (op === 'preview') {
      const port = Number(body.port);

      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return json({ ok: false, error: 'Preview port must be between 1024 and 65535.' }, { status: 400, headers });
      }

      const preview = await waitForPreview(sandbox, port);

      return json({ ok: true, preview }, { headers });
    }

    if (typeof body.command !== 'string' || !body.command.trim() || body.command.length > 8_000) {
      return json({ ok: false, error: 'A command between 1 and 8,000 characters is required.' }, { status: 400, headers });
    }

    await ensureTerminalSession(sandbox);

    const command = body.command.trim();
    const devServer = isDevServerCommand(command);
    const result = await sandbox.process.executeSessionCommand(
      TERMINAL_SESSION_ID,
      {
        command,
        runAsync: devServer,
        suppressInputEcho: true,
      },
      devServer ? 30 : 120,
    );

    let output = normalizeOutput(result);
    let preview: Awaited<ReturnType<typeof getPreview>> | undefined;

    if (devServer) {
      const port = detectDevPort(command, Number(body.port));
      preview = await waitForPreview(sandbox, port, result.cmdId);
      output += (output ? '\n' : '') + 'Daytona Preview ready on port ' + port + '.';
    }

    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : undefined;

    if (!devServer && typeof exitCode !== 'number') {
      return json({ ok: false, output, error: 'Daytona did not return an exit code for the command.' }, { status: 502, headers });
    }

    if (!devServer && exitCode !== 0) {
      return json({ ok: false, output, exitCode, error: 'Command exited with code ' + exitCode + '.' }, { status: 422, headers });
    }

    return json({ ok: true, output, exitCode, preview }, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[BeamCore] Daytona operation failed:', detail);

    const status = /not configured|missing from this/i.test(detail) ? 503 : 502;

    return json({
      ok: false,
      error: status === 503
        ? detail
        : 'Daytona could not complete the request: ' + detail,
    }, { status });
  }
}
