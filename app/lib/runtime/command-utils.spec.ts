import { describe, expect, it } from 'vitest';
import { isDaytonaUnavailableError, isDevServerCommand, normalizeProjectPath } from './command-utils';

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

  it('normalizes Windows separators to project-relative paths', () => {
    expect(normalizeProjectPath('src\\pages\\index.tsx')).toBe('src/pages/index.tsx');
    expect(normalizeProjectPath('./index.html')).toBe('index.html');
  });

  it.each(['/etc/passwd', '../outside.txt', 'src/../../outside.txt', ''])('rejects unsafe project paths: %s', (path) => {
    expect(() => normalizeProjectPath(path)).toThrow('Refusing to write outside the project directory');
  });

  it('recognizes missing credentials and runtime connectivity errors for fallback', () => {
    expect(isDaytonaUnavailableError(new Error('DAYTONA_API_KEY is missing'))).toBe(true);
    expect(isDaytonaUnavailableError(new Error('Daytona could not complete the request: 503'))).toBe(true);
    expect(isDaytonaUnavailableError(new Error('Command exited with code 1'))).toBe(false);
  });
});
