/**
 * The ask pipeline: input guard -> retrieve -> answer -> output guard -> log.
 *
 * `ask` takes its dependencies as arguments so tests can swap in fakes;
 * `createHrAssistant` wires up the real Groq / Gemini / Supabase ones.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getGroq } from "./clients";
import { LLM_MODEL, NO_CONTEXT_MESSAGE, REFUSAL_MESSAGE, SYSTEM_PROMPT } from "./config";
import { checkInput, checkOutput, type GuardResult } from "./guardrails";
import { retrievePolicyChunks, type PolicyChunk } from "./retrieve";
import { traced } from "./tracing";

export type BlockedStage = "input" | "output";

export interface AskResult {
  answer: string;
  blocked: BlockedStage | null;
  sources: PolicyChunk[];
}

export interface AskLogEntry {
  question: string;
  answer: string;
  blockedStage: BlockedStage | null;
  blockReason: string | null;
  latencyMs: number;
}

export interface AskDeps {
  checkInput(question: string): Promise<GuardResult>;
  checkOutput(answer: string): Promise<GuardResult>;
  retrieve(question: string): Promise<PolicyChunk[]>;
  generate(question: string, chunks: PolicyChunk[]): Promise<string>;
  log?(entry: AskLogEntry): Promise<void>;
}

export function buildUserMessage(question: string, chunks: PolicyChunk[]): string {
  const excerpts = chunks.map((chunk) => chunk.content).join("\n\n---\n\n");
  return `<policy_excerpts>\n${excerpts}\n</policy_excerpts>\n\nQuestion: ${question}`;
}

export async function generateAnswer(question: string, chunks: PolicyChunk[]): Promise<string> {
  const response = await getGroq().chat.completions.create({
    model: LLM_MODEL,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(question, chunks) },
    ],
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
}

export async function ask(question: string, deps: AskDeps): Promise<AskResult> {
  const startedAt = Date.now();

  const finish = async (
    result: AskResult,
    blockReason: string | null = null,
  ): Promise<AskResult> => {
    try {
      await deps.log?.({
        question,
        answer: result.answer,
        blockedStage: result.blocked,
        blockReason,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      // Logging must never break the answer.
      console.error("[hr-assistant] failed to write log", error);
    }
    return result;
  };

  // Guard and retrieval are independent, so run them in parallel.
  const [inputGuard, chunks] = await Promise.all([
    deps.checkInput(question),
    deps.retrieve(question),
  ]);
  if (!inputGuard.safe) {
    return finish({ answer: REFUSAL_MESSAGE, blocked: "input", sources: [] }, inputGuard.reason);
  }

  if (chunks.length === 0) {
    return finish({ answer: NO_CONTEXT_MESSAGE, blocked: null, sources: [] });
  }

  const answer = (await deps.generate(question, chunks)) || NO_CONTEXT_MESSAGE;

  const outputGuard = await deps.checkOutput(answer);
  if (!outputGuard.safe) {
    return finish({ answer: REFUSAL_MESSAGE, blocked: "output", sources: [] }, outputGuard.reason);
  }

  return finish({ answer, blocked: null, sources: chunks });
}

interface CreateOptions {
  /** A Supabase client. With a user session, RLS applies; with service role, it doesn't. */
  supabase: SupabaseClient;
  /** When set, each question is written to hr_assistant_logs for this user. */
  userId?: string;
}

/**
 * Real dependencies: Groq guardrails + answers, Gemini embeddings, Supabase search + logs.
 * Each step shows up as its own LangSmith run when tracing is enabled.
 */
export function createHrAssistantDeps({ supabase, userId }: CreateOptions): AskDeps {
  return {
    checkInput: traced("input_guard", "llm", checkInput),
    checkOutput: traced("output_guard", "llm", checkOutput),
    retrieve: traced("retrieve_policy", "retriever", (question: string) =>
      retrievePolicyChunks(supabase, question),
    ),
    generate: traced("generate_answer", "llm", generateAnswer),
    log: userId
      ? async (entry) => {
          const { error } = await supabase.from("hr_assistant_logs").insert({
            user_id: userId,
            question: entry.question,
            answer: entry.answer,
            blocked_stage: entry.blockedStage,
            block_reason: entry.blockReason,
            latency_ms: entry.latencyMs,
          });
          if (error) throw error;
        }
      : undefined,
  };
}

export function askHrAssistant(question: string, options: CreateOptions): Promise<AskResult> {
  const deps = createHrAssistantDeps(options);
  return traced("hr_assistant", "chain", (q: string) => ask(q, deps))(question);
}
