import { after, NextResponse } from "next/server";

import {
  ASK_RATE_LIMIT,
  askHrAssistant,
  flushTraces,
  getSupabaseAdmin,
  MAX_QUESTION_LENGTH,
} from "@/backend/lib/hr-assistant";

import { rateLimited, requireHrSession, requireHrUser } from "./_lib/admin-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/** What the signed-in user may do: drives whether the floating bot (and its admin link) shows. */
export async function GET() {
  const auth = await requireHrSession();
  if (auth.error) return auth.error;
  return NextResponse.json(auth.access, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireHrUser();
  if (auth.error) return auth.error;
  const { user } = auth;

  const limited = rateLimited("ask", user.id, ASK_RATE_LIMIT);
  if (limited) return limited;

  let question: unknown;
  try {
    ({ question } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `Question must be at most ${MAX_QUESTION_LENGTH} characters` },
      { status: 400 },
    );
  }

  after(flushTraces);

  try {
    // Service role: the policy tables are server-only (no RLS read policies), so tenants
    // can't read them directly. Access was checked above; the log is keyed to the session user.
    const result = await askHrAssistant(question.trim(), { supabase: getSupabaseAdmin(), userId: user.id });
    return NextResponse.json({
      answer: result.answer,
      blocked: result.blocked,
      sources: result.sources.map(({ source, content }) => ({ source, content })),
    });
  } catch (error) {
    console.error("[hr-assistant] request failed", error);
    return NextResponse.json(
      { error: "The HR assistant is unavailable right now. Please try again." },
      { status: 503 },
    );
  }
}
