# Booking a meeting room from a WhatsApp message

This extends the existing inbound assistant. It is not an AiSensy AI Agent action
or a general-purpose language model. It extracts common English booking phrases,
asks about missing/ambiguous values, and uses live app data for all decisions.

Examples:

- `Hey book Conference Room 1 for today from 2pm to 3pm`
- `Reserve Conference Room 2 tomorrow at 2pm for 1 hour`
- `Book meeting room` followed by `tomorrow 2 to 3 pm` and the exact room name.

Required: approved sender, accessible property, actual active room, date, start and
end times. One accessible property is inferred; multiple properties require a
name/number selection. A room is always explicitly selected. Date is asked when
omitted. Dates use Asia/Kolkata. Supported dates: today, tomorrow, day after
tomorrow, weekday names (next occurrence), DD-MM-YYYY, YYYY-MM-DD. Bare 2 to 3
requires AM/PM; explicit 14:00 to 15:00 is supported. Same-day intervals only.
The interval must be covered by the union of configured meeting_room_slots.

The draft retains answers for 20 minutes after successful prompt delivery.
Corrections are supported before creation. Past times, invalid dates, unavailable
rooms and insufficient allocated credits do not create bookings. Credit policy
matches the app: enforce existing company/user credits; no record does not
introduce a new booking restriction. Permission and interval/credit checks run
again transactionally. Request IDs and the existing overlap constraint protect
against duplicate delivery and concurrent bookings.

Success is delivered through existing MEETING_ROOM_BOOKED event_outbox processing
and existing organization WhatsApp notification configuration. No separate
assistant booking_created campaign is sent for this new flow. Ensure the booker
receives the existing booking notification and its campaign is active. Existing
guided bookings and ticket creation keep their existing behavior.

## Two templates to submit to AiSensy

Language: English. Suggested category: Utility (Meta decides approval/category).
No header, footer or buttons are required. Create active API campaigns with the
same names after approval. The parameter order below is required.

### fms_whatsapp_booking_details_v1

Body:

```text
To complete your meeting-room booking at {{1}}, please provide {{2}}.

Details received: {{3}}.

Reply with the missing details. Example: Conference Room 1, today, 2 PM to 3 PM.
```

Samples:

1. `SS Plaza`
2. `the meeting room (1. Conference Room 1; 2. Conference Room 2)`
3. `2026-10-03, 14:00 to 15:00 IST`

The same template asks for date, room, property, start/end time, or combinations;
it retains already supplied values. Room/property choices come from allowed live
records, with the first ten choices shown. Exact names can also be used.

### fms_whatsapp_booking_problem_v1

Body:

```text
We could not complete your meeting-room booking at {{1}}.

Reason: {{2}}

Next step: {{3}}
```

Samples:

1. `SS Plaza`
2. `The requested room is unavailable.`
3. `Choose an available room: 1. Conference Room 2`

## Deployment

1. If not already applied, apply
   `supabase/migrations/20261002000001_whatsapp_assistant_permanent_failures.sql`.
2. Apply `supabase/migrations/20261003000001_whatsapp_message_booking.sql`.
   This adds a service-only time-range booking RPC. Original assistant migration,
   existing credit deduction function and event_outbox triggers must be present.
   Both new migrations are reapplicable. Do not rerun the original CREATE migration.
3. Approve the two templates and activate both API campaigns.
4. Retain the existing approved greeting/menu campaign and existing notification
   campaigns. Both AISENSY_API_KEY and notification configuration must be ready.
5. Set `AISENSY_ASSISTANT_ENABLED=true` and
   `AISENSY_MESSAGE_BOOKING_ENABLED=true` in Vercel Production and redeploy.
   New flow is disabled unless the second flag is exactly true.
6. Test complete and incomplete messages with an approved account, including
   unavailable rooms and insufficient credits. Verify the outbox sends exactly the
   configured booking confirmation. No live database or WhatsApp changes are made
   by local tests.

Optional AISENSY_ASSISTANT_CAMPAIGNS JSON mapping additions:

```json
{
  "booking_details": "fms_whatsapp_booking_details_v1",
  "booking_problem": "fms_whatsapp_booking_problem_v1"
}
```

Merge these keys into existing overrides rather than replacing other mappings.

Disable only this extension with AISENSY_MESSAGE_BOOKING_ENABLED=false, then
redeploy. Existing booking data and prior guided assistant remain available.
A public unsigned inbound webhook cannot establish provider-origin authenticity;
existing approved account/property scope checks do not verify ownership of a
phone number supplied by a caller.
