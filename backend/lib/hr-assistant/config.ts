/** All HR assistant settings live here, in one place. */

export const LLM_MODEL = "openai/gpt-oss-20b";
export const GUARD_MODEL = "openai/gpt-oss-safeguard-20b";
export const JUDGE_MODEL = "openai/gpt-oss-20b";

// 768 keeps us under pgvector's 2000-dim HNSW limit. Changing it requires
// a new migration (vector(N)) and a full re-ingest.
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 60;
export const TOP_K_RESULTS = 3;

export const MAX_QUESTION_LENGTH = 1000;

// Uploaded policy documents. 4 MB stays under Vercel's 4.5 MB request body limit.
export const DOCUMENTS_BUCKET = "hr-policies";
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".pdf", ".docx"] as const;

// A document still 'processing' after this long is assumed interrupted and marked failed.
export const STALE_PROCESSING_MINUTES = 5;

// Users with one of these active organization_memberships roles (or master admins)
// can manage documents.
export const HR_ADMIN_ROLES = ["hr", "hr_head", "hr_manager", "hr_ops", "org_super_admin"];

// Outside parties: they don't get the assistant unless they also hold a staff role.
// Any role starting with "tenant" is treated as external too.
export const EXTERNAL_ROLES = [
  "super_tenant",
  "client",
  "resident",
  "vendor",
  "maintenance_vendor",
  "guest",
  "visitor",
];

// Requests per user per minute.
export const ASK_RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 };
export const UPLOAD_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };

export const REFUSAL_MESSAGE = "Sorry, I can't help with that request.";
export const NO_CONTEXT_MESSAGE =
  "I couldn't find anything about that in the HR policy. Please contact HR directly.";

export const SYSTEM_PROMPT = `You are a friendly HR assistant. Answer the employee's question using ONLY the HR policy excerpts provided in <policy_excerpts>. If the answer isn't in the excerpts, say you don't know instead of guessing. Never approve requests or promise outcomes on the company's behalf - only explain what the policy says. Keep answers short and clear.`;
