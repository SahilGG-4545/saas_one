# WhatsApp AI pilot: meeting rooms and tickets

Implemented on `feat/whatsapp-llm-interpreter`. This pilot uses the existing AiSensy webhook, assistant queue, account/property access logic, meeting-room transaction RPC and ticket classification/assignment service. It does not give the model database credentials or mutation tools.

## Try the interpreter without creating anything

After deploying the branch and applying its additive migration to your test database, open **Account Settings → WhatsApp (AiSensy) Service → WhatsApp AI pilot** as an approved **Organization Super Admin**. The preview works independently of pilot enablement. Enter a booking or ticket message and click **Preview interpretation**. It shows extracted source phrases and `executed: false`; it never books, creates a ticket or saves a draft.

Example: `Book conference room 1 tomorrow from 2.30 PM to 3 PM`. Preview should return room/date/start/end phrases. An omitted property stays null. The real conversation resolves IDs only from the sender's current app permissions.

## Deployment configuration

The worktree does not contain live Groq/AiSensy credentials. Use your existing server-only Vercel environment variables; do not put keys in client code or template parameters.

```dotenv
GROQ_TASK_CHAT_API_KEY=<your existing dedicated Groq task chat key>
# Optional; default below:
GROQ_TASK_CHAT_MODEL=llama-3.3-70b-versatile
AISENSY_PROJECT_ID=<same project as the incoming webhook>
AISENSY_PROJECT_API_KEY=<existing Project API password>
AISENSY_API_KEY=<existing campaign key>
AISENSY_ASSISTANT_ENABLED=true
# Keep false while configuring, then enable in the test deployment:
WHATSAPP_LLM_INTERPRETER_ENABLED=false
```

The interpreter reads **only `GROQ_TASK_CHAT_API_KEY`**; it never falls back to other Groq keys. Existing ticket classification and Task Manager retain their own current providers. Redeploy after changing Vercel variables. The new pilot does not require `AISENSY_MESSAGE_BOOKING_ENABLED`; non-pilot callers retain that switch's existing behavior.

Apply `supabase/migrations/20261005000002_whatsapp_llm_interpreter.sql` after the existing assistant and message-booking migrations. It adds organization settings, private outgoing reply aliases, `tickets.wa_assistant_completed` to distinguish a fully processed ticket from an interrupted attachment/assignment pipeline, and `wa_assistant_input_hash` to keep committed ticket details immutable during recovery. It does not replace booking/ticket RPCs or migrate existing records. No live database migration was run from this workspace.

In organization settings, add your account with **Add my account to the pilot**, enable the desired two actions, and save. Enable `WHATSAPP_LLM_INTERPRETER_ENABLED=true` in the test deployment after the keys, migration and campaigns are ready. Both the global switch and organization/user allowlist must match. Incoming messages must carry the configured AiSensy project ID. Non-pilot senders continue through existing routing.

## Templates and notifications

| Message | Delivery |
| --- | --- |
| HI greeting and Create Ticket / Book Meeting Room buttons | Existing `fms_whatsapp_menu_v1` API campaign |
| Property/room choices, missing information, review, corrections and validation | Free-form Project API inside the 24-hour inbound service window |
| Follow-up if that window has closed, or Project API reports a permanent failure | Existing approved `fms_whatsapp_notice_v1` campaign; one parameter with the same factual message |
| Ticket created/assigned | Existing omnichannel `ticket_created` / `ticket_assigned` event configuration and campaigns |
| Meeting room booked | Existing omnichannel `meeting_room_booked` event configuration and campaign |

Keep menu and notice campaigns active. Ensure **requester** delivery is enabled in Omnichannel for ticket creation and meeting-room booking; the interpreter does not send a second completion message. Existing campaign-name overrides in `AISENSY_ASSISTANT_CAMPAIGNS` still apply. Do not disable old campaigns globally: non-pilot users still use the guided template flow.

For ticket photos, set `WHATSAPP_MEDIA_ALLOWED_HOSTS` to a comma-separated list of the **exact HTTPS media hostnames your AiSensy webhooks deliver**. Without it, the two existing documented S3 media-library hostnames are permitted. No wildcard host or arbitrary URL is allowed. Downloads pin a public IPv4 DNS result, reject redirects, allow JPEG/PNG/WebP/GIF, cap bytes at 10 MiB, time out after 10 seconds and decode/recompress with a 20-million-pixel limit before ticket creation. If your provider uses a redirecting media URL, use its permitted final media URL integration or continue with a text-only ticket; never allow private hosts.

## Live conversation tests

1. Send `HI` and choose **Book Meeting Room**. Send `Book conference room 1 tomorrow from 2.30 PM to 3 PM`. If you have several properties, choose the property by name/number. Confirm the displayed room, date, time and credit summary with **Confirm Booking**. Verify the actual app booking, one credit deduction and your standard notification.
2. Start another booking and send only `3 PM to 4 PM`. The supplied times stay saved while the bot asks for date/room. Change the time, then confirm the updated review. Missing AM/PM, past times, invalid dates and unavailable slots never execute.
3. Send `HI` → **Create Ticket** → `Floor lighting is not working` → **Submit Ticket**. Photo is optional. Verify the ticket reference in the standard notification and existing classification/assignment in the app.
4. Repeat with a photo caption describing the issue. A bare photo asks for a description. **Add Photo** requests an attachment; **No Photo** removes it and produces a new review. Unsupported media cannot create a photo-backed ticket.
5. While a booking is pending, send `TASKS` or `DONE 1`. Existing Task Manager handles those explicit commands; the facility draft remains saved. Return with the booking menu option or quote its latest mapped prompt. A bare `yes`, `done` or numbered answer with competing contexts asks clarification. Use **Cancel Tasks** to cancel only Task Manager; **Cancel** cancels a facility request when unambiguous. A task-quoted Cancel also routes to Task Manager.
6. Quote an old/completed prompt, another recipient's message, or an unknown notification. The bot asks you to use the latest prompt. A quoted task completion cannot use today's task numbering from an old digest; send TASKS to get the current list and issue an explicit unquoted command instead.

Drafts expire after 20 minutes of inactivity per workflow. Booking and ticket drafts are separate. Review fingerprints include resolved IDs/date/time; changes in default-today date or singleton room require another review. Successful resources are recovered by stable request IDs on a worker retry; the model cannot create a duplicate resource by proposing an action ID. Stored ticket photos are reused even after a provider URL expires. Once a domain row exists, a correction cannot repurpose that operation ID for another property/issue/room/time; start a new menu request for changed details.

Ticket recovery preserves an existing assignee and escalation progress. An interrupted open, unassigned ticket resumes the existing assignment service using its stored classification.

## Boundaries and verification

This is a menu-led pilot, not automatic intent dispatch for every incoming message. Arbitrary messages do not become tickets. Only booking and ticket details are passed to Groq, with no other users' records, resource lists, phone number or credentials in the prompt. The model proposes source-grounded phrases; backend code asks questions, validates fresh scope and executes existing services only after explicit confirmation. The parser supports explicit AM/PM (including `2.30 PM`) and 24-hour `HH:MM`; it asks again for ambiguous times. Dates currently support today/tomorrow, ISO or DD-MM-YYYY. Optional attendee/comment fields and autonomous Task Manager interpretation are future adapters.

An LLM can misinterpret text; schema validation, source grounding, backend permission checks and exact-action confirmation limit its effects. They do not prove perfect NLP accuracy. Model failure/invalid output asks for clarification and never executes. The plain webhook/account-by-phone association preserves the existing requested integration; project-ID matching is a routing check, not cryptographic authentication of the sender. The new feature does not change that existing trust boundary.

`npm run test:whatsapp` includes both legacy and pilot tests; `npm run test:whatsapp-interpreter` runs the focused pilot suites. Tests cover Groq request/response boundaries, invented fields, cross-workflow fields, access revocation, missing details, photos, review changes, task ambiguity, old quotes, operation recovery, delivery retries, 24-hour windows, media limits, organization API authorization and database RLS. Existing database tests exercise real atomic booking/credit/overlap RPCs in isolated PGlite. Fixtures are offline: live model accuracy, provider-returned ID/context alias matching, template availability, outbox requester settings and delivery latency still need the above Vercel tests.

Vercel logs report `[WhatsAppInterpreter]` workflow/accepted/reason/duration and `[WhatsAppAssistant]` event completion duration. Message bodies, account/property data and Groq credentials are not logged by the interpreter.

## Disable / rollback

Set `WHATSAPP_LLM_INTERPRETER_ENABLED=false` and redeploy to return new messages to the existing routing. Pending pilot events receive a standard pause notice; they do not run as legacy default tickets. Existing resources/outbox events remain intact. The additive migration can remain installed. Do not drop its completion-marker column while this branch is running. No push, merge, deployment or production migration is performed as part of this local implementation.
