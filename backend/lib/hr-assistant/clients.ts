/** Lazily-created SDK clients, so importing this module never needs env vars. */
import Groq from "groq-sdk";

let groq: Groq | undefined;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to your environment (.env.local).`);
  return value;
}

export function getGroq(): Groq {
  return (groq ??= new Groq({ apiKey: requireEnv("GROQ_API_KEY") }));
}

/** Same key fallback as the rest of the app (backend/services/aiProcessor.ts uses GOOGLE_AI_API_KEY). */
export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY (or GOOGLE_AI_API_KEY). Add it to .env.local.");
  return key;
}
