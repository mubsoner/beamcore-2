interface Env {
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  AI_PROVIDER?: 'gemini' | 'groq' | 'openrouter';
  GROQ_MODEL?: string;
  GEMINI_MODEL?: string;
  OPENROUTER_MODEL?: string;
}
