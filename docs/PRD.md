# Product requirements

**Status:** Draft v1 · **Owner:** Shola Ayeni · **Updated:** 2026-11-05
**Related:** [SPEC](../SPEC.md) · [Requirements](REQUIREMENTS.md) · [Design system](DESIGN_SYSTEM.md) · [Roadmap](ROADMAP.md)

## 1. Summary

Frontdesk is an AI front desk on WhatsApp (and SMS) for appointment-based small businesses. It answers customer messages, quotes services, books real slots, takes a deposit, sends reminders and hands off to the owner when it shouldn't decide alone.

The pitch to owners: **"Never miss a booking message while your hands are busy."**

## 2. Problem

Small service businesses take bookings by message, but the owner is usually the one doing the work: grooming a dog, detailing a car, braiding hair. Messages wait for hours. Customers book elsewhere, prices get misquoted from memory, and deposits are chased by hand. No-shows cost a slot the owner could have sold.

What owners use today: their personal WhatsApp, a paper diary or Google Calendar, and sometimes a booking link few customers use. Booking tools exist, but they expect the customer to leave the chat and fill in a form.

## 3. Users

| Persona | Who | What they need |
|---|---|---|
| **Owner (primary buyer)** | A solo operator or 2–5 person shop. Busy with their hands, on the phone between jobs. | Bookings land without them typing; deposits paid upfront; control when something's odd; a quick "what happened today" view. |
| **Customer** | Messages the business on WhatsApp, often after hours. | A fast, accurate answer; a real time slot; a simple way to pay a deposit; reminders; easy reschedule or cancel. |
| **Staff (v2)** | Employees of a larger shop | Out of scope for v1 beyond simple capacity. |

## 4. Goals and non-goals

**Goals (v1)**
- G1. Complete the inquiry → quote → hold → deposit → confirmed → reminder flow with no human involved.
- G2. Never double-book, never invent a price or time, never confirm a booking that isn't paid.
- G3. Hand off to the owner promptly and correctly when a conversation needs a human, and stay silent while the owner has the thread.
- G4. Give the owner a minimal dashboard: conversations, bookings, takeover and settings.
- G5. Make every agent decision traceable, and every change measurable against an eval suite.

**Non-goals (v1)**: voice calls, Instagram DMs, multi-staff scheduling beyond simple capacity, refunds (the owner handles them manually), a pricing or billing page, and Google Calendar sync (v2).

## 5. Core journeys

1. **New booking.** The customer asks about a service. The agent answers from the configured services, offers 2–3 real slots, holds one for 15 minutes, sends a Stripe deposit link, and confirms once Stripe's webhook says it's paid.
2. **Question only.** The customer asks about prices, hours, location or policy. The agent answers from config and the FAQ and offers to book.
3. **Reschedule or cancel.** A known customer asks to move or cancel. The agent checks the cancellation policy window and availability, then moves or cancels.
4. **Reminders.** 24 hours and 2 hours before the appointment, the customer gets a reminder and can reply to confirm or cancel.
5. **Handoff.** A complaint, refund request, health concern, unpriced request or low-confidence answer triggers a handoff. The owner gets a WhatsApp summary and can reply to take over. The agent stays silent on that thread until the owner hands it back.
6. **Owner's day.** The owner opens the dashboard to see today's bookings, open handoffs, and any conversation's full history and agent trace.

## 6. Success metrics

| Metric | Target for the pilot | Measured from |
|---|---|---|
| Booking completion rate (booking-intent conversations that end confirmed) | ≥ 60% | `Conversation` + `Booking` |
| Correct-handoff rate (handoffs the owner agrees were needed) | ≥ 85% | Owner review in the dashboard |
| Double bookings | 0 | `Booking` overlap check |
| Wrong price or invented slot | 0 | Eval suite + owner reports |
| p95 time from inbound message to reply | ≤ 10 s | `AgentRun.latencyMs` |
| Cost per booked conversation | Track and publish; first target ≤ $0.10 | `AgentRun` tokens × price |
| Eval pass rate (40+ scenarios) | ≥ 90% before the pilot goes live | CI eval report |

The targets are starting points to measure against, not claims. Publish real numbers only.

## 7. Pilot plan

- **Who:** one appointment-based small business, chosen before the pilot milestone.
- **Offer:** a free 30-day pilot on its existing WhatsApp number or a new one. The owner can take over any conversation at any time.
- **Before go-live:** the eval suite passes at the target, the owner approves the service list, prices and policies in config, and a test booking with a real deposit is made and refunded.
- **During:** a daily review of conversations and traces; failures become new eval scenarios.
- **Exit:** convert to paid, extend, or stop. Report the metrics in §6 either way.

## 8. Risks and fallbacks

| Risk | Impact | Fallback |
|---|---|---|
| Meta business verification or WhatsApp template approval is slow | Can't go live on WhatsApp, or can't send reminders outside the 24-hour window | Start with Twilio SMS. Use the WhatsApp test number for development. Submit templates as soon as the Meta app exists. |
| The pilot business doesn't have or want a Stripe account | No deposits | Run the pilot on the developer's Stripe in test mode for demos. For the real pilot, use "pay at appointment" with the reminder flow. |
| The LLM provider is down or slow | Customers get no reply | Queue retries with backoff. After N failures, send a canned "the owner will reply shortly" message and hand off. |
| The agent says something wrong to a real customer | Trust and reputation | Guardrails in code (prices, slots, payment confirmation), forced-handoff triggers, owner takeover, and daily trace review. |
| The pilot owner churns early | No production numbers | Keep two or three prospects warm and offer the pilot to the next one. |

## 9. Open questions

- Which pilot business and phone number? (Decide before the deposits milestone.)
- WhatsApp Business Cloud API: use the developer's Meta app, or the owner's?
- Whether to price after the pilot, and how much (v2).
