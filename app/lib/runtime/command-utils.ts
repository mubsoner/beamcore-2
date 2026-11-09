const DEV_SERVER_COMMANDS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|preview)\b/i,
  /\b(?:npx\s+)?vite(?:\s+(?:dev|preview))?(?:\s|$)/i,
  /\bnext\s+(?:dev|start)\b/i,
  /\breact-scripts\s+start\b/i,
  /\b(?:astro|remix)\s+(?:dev|vite:dev)\b/i,
];

export function isDevServerCommand(command: string) {
  return DEV_SERVER_COMMANDS.some((pattern) => pattern.test(command));
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
  return /DAYTONA_API_KEY|Daytona request failed|Daytona could not complete|Failed to fetch|NetworkError|ECONN|\b50[023]\b|timed out/i.test(detail);
}
