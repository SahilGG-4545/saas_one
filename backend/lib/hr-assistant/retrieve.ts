/** Find the policy chunks most similar to a question (Supabase pgvector). */
import type { SupabaseClient } from "@supabase/supabase-js";

import { TOP_K_RESULTS } from "./config";
import { embedQuery } from "./embeddings";

export interface PolicyChunk {
  id: number;
  source: string;
  content: string;
  similarity: number;
}

export async function retrievePolicyChunks(
  supabase: SupabaseClient,
  question: string,
  k: number = TOP_K_RESULTS,
): Promise<PolicyChunk[]> {
  const queryEmbedding = await embedQuery(question);
  const { data, error } = await supabase.rpc("match_hr_policy_chunks", {
    query_embedding: queryEmbedding,
    match_count: k,
  });
  if (error) throw new Error(`HR policy search failed: ${error.message}`);
  return (data ?? []) as PolicyChunk[];
}
