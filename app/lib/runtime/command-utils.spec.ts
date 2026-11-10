import { describe, expect, it } from 'vitest';
import { getProjectPreviewPort, isDaytonaUnavailableError, isDevServerCommand, normalizeProjectPath } from './command-utils';

describe('runtime command utilities', () => {
  it.each([
    'npm run dev',
    'pnpm dev -- --host 0.0.0.0',
    'yarn start',
    'bun run preview',
    'npx vite --host 0.0.0.0',
    'next dev --port 3000',
    'npm install && npm run dev',
  ])('recognizes dev server command: %s', (command) => {
    expect(isDevServerCommand(command)).toBe(true);
  });

  it.each(['npm install', 'node scripts/build.js', 'echo "start dev server later"'])('does not classify a regular command as a server: %s', (command) => {
    expect(isDevServerCommand(command)).toBe(false);
  });

  it('detects preview ports from explicit flags and framework dependencies', () => {
    expect(getProjectPreviewPort('npm run dev -- --port 4200')).toBe(4200);
    expect(getProjectPreviewPort('npm run dev', {
      '/home/project/package.json': { type: 'file', content: JSON.stringify({ dependencies: { next: '15.0.0' } }) },
    })).toBe(3000);
    expect(getProjectPreviewPort('vite preview', {
      '/home/project/package.json': { type: 'file', content: JSON.stringify({ devDependencies: { vite: '5.0.0' } }) },
    })).toBe(4173);
    expect(getProjectPreviewPort('astro dev')).toBe(4321);
  });

  it('normalizes Windows separators to project-relative paths', () => {
    expect(normalizeProjectPath('src\\pages\\index.tsx')).toBe('src/pages/index.tsx');
    expect(normalizeProjectPath('./index.html')).toBe('index.html');
  });

  it.each(['/etc/passwd', '../outside.txt', 'src/../../outside.txt', ''])('rejects unsafe project paths: %s', (path) => {
    expect(() => normalizeProjectPath(path)).toThrow('Refusing to write outside the project directory');
  });

  it('uses browser fallback only when Daytona is unavailable, not when a project command fails', () => {
    expect(isDaytonaUnavailableError(new Error('DAYTONA_API_KEY is missing'))).toBe(true);
    expect(isDaytonaUnavailableError(new Error('Daytona request failed (503).'))).toBe(true);
    expect(isDaytonaUnavailableError(new Error('Daytona could not complete the request: The dev server did not become reachable'))).toBe(false);
    expect(isDaytonaUnavailableError(new Error('Command exited with code 1'))).toBe(false);
  });
});
