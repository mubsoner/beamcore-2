import { env } from 'node:process';

export function getAPIKey() {
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server.');
  }

  return apiKey;
}
