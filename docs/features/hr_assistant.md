# HR Policy Assistant

A floating bot in the bottom-right corner of every dashboard page. Employees and staff can
ask it about company HR policy. It answers **only** from the live version of each uploaded
policy and runs safety checks on every question and every answer. HR admins upload,
version and restore the policies on `/{orgId}/hr-assistant/documents`.

This is a port of a standalone Next.js mini project. The assistant's behaviour (prompts,
models, guardrail policies, fail-closed guard parsing, retrieval, versioning SQL and
background indexing) was kept as-is. Only the wiring was adapted to this codebase. See
"Adapted for this codebase" below.

Screenshots from the standalone build (before restyling) are in [hr-assistant/screenshots/](hr-assistant/screenshots/).

## Where things live

| What | Path |
| :--- | :--- |
| Floating bot (launcher and window) | `frontend/components/hr-assistant/HrAssistantBot.tsx` |
| Chat panel and conversation store | `frontend/components/hr-assistant/HrAssistantChat.tsx` |
| Mascot SVG | `frontend/components/hr-assistant/BotFace.tsx` |
| Policy manager UI | `frontend/components/hr-assistant/HrDocumentManager.tsx` |
| Policy manager page (HR admins only, 404 otherwise) | `app/(dashboard)/[orgId]/hr-assistant/documents/page.tsx` |
| Bot mount points | `app/(dashboard)/layout.tsx`, in all three layout branches |
| API routes | `app/api/hr-assistant/**` |
| Pipeline, ingest, versioning, access | `backend/lib/hr-assistant/` (`config.ts` holds every setting) |
| Migration | `supabase/migrations/20261019000001_hr_assistant.sql` |
| Offline tests | `tests/hr-assistant/` (`npm run test:hr-assistant`) |
| Seed and eval scripts | `scripts/hr-assistant/` (`npm run hr:ingest`, `npm run hr:eval`) |
| Demo policy for seeding | `data/hr-assistant/hr_policy.txt` |

## Who can do what

Access is decided **on the server** in `getHrAccess()` (`backend/lib/hr-assistant/admin.ts`).
It reads roles from the database (`users.is_master_admin`, active
`organization_memberships` and `property_memberships`) and never from `user_metadata`.
Any database read error fails closed, meaning no access.

| Who | Chat with the bot | Manage documents |
| :--- | :---: | :---: |
| Master admins, and org roles `hr`, `hr_head`, `hr_manager`, `hr_ops`, `org_super_admin` | ✅ | ✅ |
| Any other staff role (org or property level) | ✅ | ❌ |
| Only external roles (`tenant*`, `super_tenant`, `client`, `resident`, `vendor`, `maintenance_vendor`, `guest`, `visitor`) | ❌ | ❌ |
| No active membership | ❌ | ❌ |

- **Admin rights are org-level only.** A property-level `hr` role can chat but not manage documents.
- **Changing the lists:** edit `HR_ADMIN_ROLES` / `EXTERNAL_ROLES` in `config.ts`, and update the tests in `tests/hr-assistant/ingest.test.ts`.
- **How the bot decides to show:** it calls `GET /api/hr-assistant` once per signed-in user and renders nothing unless `canUse` is true. `POST /api/hr-assistant` enforces the same check, so hiding the bot is not the only barrier.
- **Server-only tables:** `hr_policies`, `hr_documents` and `hr_policy_chunks` have RLS on and **no** read policies, and `match_hr_policy_chunks` is revoked from `anon` and `authenticated`. A tenant can't read policy text, drafts or uploader emails with the public key. The ask route searches through the service role after the access check. `hr_assistant_logs` keeps "users read their own rows".

## How it works

**Ask** (`POST /api/hr-assistant`, rate-limited to 20 per user per minute):

1. Check the session and the `canUse` access.
2. Run the input guard and the pgvector search over live versions in parallel.
3. Groq answers from the top 3 chunks.
4. The output guard checks the answer.
5. Log the Q&A to `hr_assistant_logs`.

**Upload** (HR admins only, 10 per user per minute): `POST /api/hr-assistant/policies` (new
file, matched to a policy by name) or `POST /api/hr-assistant/policies/[id]/versions` ("New
version").

1. The route validates the file (PDF, DOCX, TXT or MD, up to 4 MB) and extracts its text (`unpdf` / `mammoth`).
2. It stores the original in the private `hr-policies` bucket.
3. It records the next version as `processing` and replies `202`.
4. Then, in `after()`, it chunks, embeds and stores the text, and calls `hr_set_live_version()`.

**Versioning rules** (enforced in SQL):

- **One live version:** a policy has at most one `ready` (live) version, enforced by a partial unique index.
- **The switch is one transaction:** promoting a new version archives the old one in the same transaction.
- **Instant restore:** archived versions keep their chunks.
- **Slow older uploads can't win:** a slow older upload never overrides a newer live version.
- **Unique version numbers:** they are allocated under a row lock, so two simultaneous uploads get v2 and v3.

**Self-healing:** if a background step fails, the version is marked `failed` and the previous
version stays live. A version still `processing` after 5 minutes is marked `failed` the next
time the list loads.

**Other routes** (HR admins only):

| Route | What it does |
| :--- | :--- |
| `GET /api/hr-assistant/policies` | Policies with their version history |
| `DELETE /api/hr-assistant/policies/[id]` | Delete a policy, all versions, chunks and files |
| `POST /api/hr-assistant/versions/[id]/restore` | Make an archived version live |
| `GET /api/hr-assistant/versions/[id]/download` | Redirect to a 60-second signed link to the original |
| `DELETE /api/hr-assistant/versions/[id]` | Delete an archived or failed version |

## Environment

No new key names. All of these are already used elsewhere in the app:

| Variable | Used for |
| :--- | :--- |
| `GROQ_API_KEY` | Answers (`openai/gpt-oss-20b`) and guardrails (`openai/gpt-oss-safeguard-20b`) |
| `GEMINI_API_KEY`, falling back to `GOOGLE_AI_API_KEY` | Embeddings (`gemini-embedding-001`, 768 dims) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Session client |
| `SUPABASE_SERVICE_ROLE_KEY` | Uploads, deletes, role lookup and scripts (server only) |

## Adapted for this codebase

- **Login and admin client:** the code uses `frontend/utils/supabase/server.ts` and `createAdminClient()` instead of its own clients.
- **HR admin check:** the original `app_metadata.role` check was replaced with the role rules above.
- **Embeddings:** these call the Gemini REST API with `fetch`. This app's `@google/generative-ai` 0.24 can't set `outputDimensionality`, and we didn't want a second Google SDK.
- **LangSmith:** it was not installed. `tracing.ts` keeps the `traced` / `flushTraces` hooks as pass-throughs.
- **Pages:** the standalone `/hr-assistant` chat page was replaced by the floating bot. The policy manager moved under the dashboard route group.
- **UI parts:** `window.confirm` became `ConfirmModal` and success notices became `Toast`. Errors stay inline (`role="alert"`) so they persist.
- **Rate limits:** added with the existing in-memory `checkRateLimit`.
- **Migration test:** `tests/hr-assistant/migration.test.ts` (PGlite + pgvector) **skips itself** unless `@electric-sql/pglite-pgvector` is installed as a dev dependency. Our PGlite 0.5.8 doesn't bundle pgvector.

## Known limits

- **Scanned PDFs (images only)** are rejected with a "needs OCR" message.
- **4 MB per upload,** because of Vercel's request-body limit.
- **Background indexing has 60 s per file** (`maxDuration`). A file that's too large ends up `failed`, and HR can split it.
- **The rate limiter is in memory,** so it's per server instance, the same as the rest of the app.
- **The conversation is cleared by a full page reload.** It is kept across in-app navigation.

## Agent Spec — HR Policy Assistant

**1. Workflow or agent?** Workflow (fixed retrieve → answer → guard pipeline; the model makes no tool choices) `[BAA p.104]`.
   Justification `[BAA p.115]`: N/A. It is a workflow, the doctrine default. The pathway is known ahead of time with few edge cases `[BAA p.104]`.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no prior path exists.

**2. Context** `[BAA p.112]`
   What it knows that its neighbours don't: only the top-3 chunks of the *live* HR policy versions, plus a system prompt limiting it to those excerpts.

**3. Cost of a false positive** `[BAA p.112]`
   High: a wrong or promised answer about leave or notice could be acted on. Model tier: `openai/gpt-oss-20b` (small) for the answer, *because* its blast radius is boxed in by two `gpt-oss-safeguard-20b` guards (fail closed), an excerpts-only prompt and a "contact HR" fallback.

**4. Tools**
   | tool | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
   |---|---|---|---|---|
   | N/A: no model-invoked tools. Retrieval runs before the model, in code. | N/A | N/A. Pipeline errors return a 503 message, and logging failures never break the answer. | Question validated (string, non-empty, ≤ 1000 chars) | N/A |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: no, a single-step answer prompt. Explicit no-skip clause: N/A.
   Single-shot tone example: no (guard policies carry examples). Terminal state written to data: yes, every run writes one `hr_assistant_logs` row (answer, blocked stage, reason, latency).

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? Partly (common questions), but it is answered from retrieval, not memory. No write tool.

**7. Multi-agent?** `[BAA p.116]`
   Single pipeline. The guards are separate model calls with their own model, so a change to the answer prompt can't regress the safety checks.

**8. Evaluation: all four axes** `[BAA pp.118–119]`
   - **System:** latency logged per question (`latency_ms`). Provider errors surface as 503s and are logged to the console.
   - **Quality assurance** `[BAA pp.96–98]`: `npm run hr:eval`, 10 fixed cases, correctness and groundedness, pass rate ≥ 0.8 gate. Judge family gpt-oss (same as the answerer), tier small, pass/fail scale, manual audit 0%. See §10.
   - **Tool interaction** `[BAA p.95]`: N/A, no tools.
   - **Agent efficiency** `[BAA p.119]`: fixed 3 Groq calls and 1 embedding call per question. Tokens are not recorded.

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry wired: run-level only (`hr_assistant_logs`). Step hooks (`traced`) exist but are no-ops.
   Ad-hoc single-agent testing done before scale `[BAA p.116]`: offline tests only (40 pass). Not yet run against live Groq, Gemini or Supabase.

**10. Laws knowingly violated, and why:**
   - **L6** `[BAA pp.96–97]`: the eval judge is the same family and size as the answerer, and scores pass/fail rather than 0–3, with no manual audit. Kept unchanged from the source project. Fix by moving the judge to a different family and a mid-tier model with a `{reasoning, score}` 0–3 schema.
   - **L14** `[BAA p.119]`: no per-step traces or token counts, because LangSmith was left out to avoid a new dependency. The run-level log covers audit.
   - **L5** `[BAA p.119]`: the efficiency axis is unmeasured (no token counts), for the same reason as L14.
   - Not wired into `backend/lib/agents/` runtime telemetry: it is a workflow with its own log table, not an agent run.
