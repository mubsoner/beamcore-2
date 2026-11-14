const DEV_SERVER_COMMANDS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|preview)\b/i,
  /\b(?:npx\s+)?vite(?:\s+(?:dev|preview))?(?:\s|$)/i,
  /\bnext\s+(?:dev|start)\b/i,
  /\breact-scripts\s+start\b/i,
  /\b(?:astro|remix)\s+(?:dev|vite:dev)\b/i,
  /\b(?:vite|next|astro|remix|webpack|parcel)\b[^\n]*(?:--host|--port)/i,
];

export function isDevServerCommand(command: string) {
  return DEV_SERVER_COMMANDS.some((pattern) => pattern.test(command));
}

type ProjectFileLookup = Record<string, { type: string; content?: string } | undefined>;

export function getProjectPreviewPort(command: string, files: ProjectFileLookup = {}) {
  const explicitPort = command.match(/(?:--port\s+|--port=|PORT=)(\d{2,5})/i);
  if (explicitPort) {
    const port = Number(explicitPort[1]);
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) return port;
  }

  const packageEntry = Object.entries(files).find(
    ([filePath, entry]) => entry?.type === 'file' && /(^|\/)package\.json$/i.test(filePath),
  );

  if (packageEntry?.[1]?.content) {
    try {
      const manifest = JSON.parse(packageEntry[1].content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const packages = { ...manifest.dependencies, ...manifest.devDependencies };
      if (packages.next || packages['react-scripts']) return 3000;
      if (packages.astro) return 4321;
      if (packages.vite) return /\bvite\s+preview\b/i.test(command) ? 4173 : 5173;
    } catch {
      // package.json may still be streaming.
    }
  }

  if (/\b(?:next\s+(?:dev|start)|react-scripts\s+start|npm\s+start)\b/i.test(command)) return 3000;
  if (/\bastro\s+dev\b/i.test(command)) return 4321;
  if (/\bvite\s+preview\b/i.test(command)) return 4173;
  return 5173;
}

export function normalizeProjectPath(path: string) {
  const requestedPath = path.replace(/\\/g, '/');
  const normalizedPath = requestedPath.replace(/^\.\//, '');
  if (
    !normalizedPath ||
    normalizedPath.startsWith('/') ||
    normalizedPath.includes('\0') ||
    normalizedPath.split('/').some((segment) => segment === '..') ||
    normalizedPath === '.'
  ) {
    throw new Error('Refusing to write outside the project directory: ' + path);
  }
  return normalizedPath;
}

export function isDaytonaUnavailableError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return /DAYTONA_API_KEY|Daytona request failed|Failed to fetch|NetworkError|ECONN|\b50[023]\b|timed out/i.test(detail);
}
