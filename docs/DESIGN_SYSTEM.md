# Frontdesk — Design System

**Status:** Draft v1 · **Updated:** 2026-11-01
**Source of truth:** [`design/tokens.ts`](../design/tokens.ts) → generated `styles/tokens.css` (via [`design/fluid.ts`](../design/fluid.ts))
**Related:** [PRD](PRD.md) · [Requirements](REQUIREMENTS.md) · [Build plan](BUILD_PLAN.md)

Frontdesk has two surfaces, and this system covers both:

1. **The owner dashboard** (Next.js): tokens, CSS layers, components and patterns.
2. **The chat surface** (WhatsApp and SMS): the agent's voice, message formats and fixed wording.

The pipeline is ported from Picture Perfect Pets (`job_search/small-business-demo-prospects/picture-perfect-pets`): `design/tokens.ts` + `design/fluid.ts` → `npm run tokens`, plus `audit:tokens` and `audit:units`. Only the brand and the component set change.

---

## 1. Principles

- **Status at a glance.** An owner glances between jobs. Who is handling each conversation (agent, owner, closed) and each booking's state must read from colour, label and position, never from colour alone.
- **Calm, not cute.** A tool owners trust with their customers. Neutral surfaces, one brand colour, no illustrations in the working UI.
- **Dense but touchable.** Lists are compact, but every control is at least 2.75rem tall (NFR-7).
- **Every size scales with the user's font size.** Only rem, em and %; media queries in em (NFR-8).
- **One source of truth.** Components use semantic tokens only, never palette values or literals.

## 2. Tokens

All values live in `design/tokens.ts`. The CSS custom properties are generated; don't edit them by hand.

### Colour

**Brand:** *Lagoon*, a deep teal (`lagoon-700 #165550` as accent on light, `lagoon-300` on dark). It is chosen to be clearly different from WhatsApp green, so the dashboard never looks like a WhatsApp clone. **Neutrals:** *Slate*, cool greys.

Semantic roles (light/dark pairs defined for each):

| Group | Tokens | Use |
|---|---|---|
| Surfaces | `bg`, `bg-subtle`, `surface`, `surface-raised`, `surface-sunken`, `surface-inverse` | Page, cards, panels, wells, toasts |
| Text | `text`, `text-muted`, `text-subtle`, `text-inverse` | Body, secondary, hints, on inverse |
| Lines | `border`, `border-strong`, `focus` | Dividers, inputs, focus ring |
| Accent | `accent`, `accent-hover`, `accent-soft`, `accent-contrast` | Primary buttons, links, selected rows |
| Feedback | `success`, `warning`, `danger`, `info` (+ `-soft`) | Alerts and inline validation |
| Bubbles | `bubble-customer`, `bubble-agent`, `bubble-owner`, `bubble-system` | Thread view |
| Conversation state | `state-agent`, `state-owner`, `state-closed` (+ `-soft`) | List badges, thread header |
| Booking state | `booking-pending`, `-confirmed`, `-cancelled`, `-completed`, `-no-show` (+ `-soft`) | Booking badges and calendar chips |

**Contrast:** every text and background pair in `contrastPairs` reaches WCAG AA in both themes: 4.5:1 for text, 3:1 for borders and focus. Checked on 2026-11-01: all 32 pairs pass in light and dark. `npm run audit:tokens` re-checks on every build.

Dark mode follows `prefers-color-scheme` unless `data-theme` is set on `:root`.

### Typography

- **Fonts:** Inter (text), Inter Tight (headings), JetBrains Mono (trace payloads and ids). Self-hosted, with system fallbacks.
- **Fluid type scale:** steps −2…5. The base grows from 0.9375rem to 1rem between a 20rem and an 80rem viewport, with a ratio of 1.15 → 1.2. This is tighter than a marketing site, because the dashboard is dense.
- **Usage:** step 0 for body and list rows; −1 for metadata and timestamps; −2 for badges; 1–2 for panel titles; 3–4 for page titles; 5 for the empty-state headline only.
- Line height 1.5 for body and 1.15 for headings; `tabular-nums` for times, prices and counts.

### Space, size and shape

- **Fluid space scale:** `3xs`…`3xl` (0.25× to 6× the base), plus pairs (`s-l`, …) for layout gaps that stretch further.
- **Layout widths:** sidebar 16rem, conversation list 22rem, detail panel 26rem, content max 80rem.
- **Radii:** 0.25rem (xs) to 1rem (l), and 1.125rem for message bubbles.
- **Controls:** s 2rem (desktop-only dense actions), m 2.75rem (default), l 3.25rem.
- **Elevation:** three shadow levels, all rem offsets. Motion: 120/200/320ms with ease-out. `prefers-reduced-motion` removes non-essential motion in `base.css`.
- **Breakpoints:** sm 30em, md 48em, lg 64em, xl 80em.

## 3. CSS architecture

Layer order, declared once in the generated `tokens.css`:

```
@layer reset, tokens, base, layout, components, patterns, utilities;
```

| Layer | Files | Contents |
|---|---|---|
| reset | `reset.css` | Modern reset (ported) |
| tokens | `tokens.css` (generated) | Custom properties, light and dark |
| base | `base.css` | Element defaults, focus ring, reduced motion |
| layout | `layout.css` | Stack, cluster, sidebar, switcher, the three-pane app shell |
| components | `components/*.css` | button, form, controls, surface, table, feedback, navigation (ported), badge, bubble |
| patterns | `patterns/*.css` | `workspace` (app shell, ported), `thread` (adapted from PPP `chat.css`), `trace`, `bookings` |
| utilities | `utilities.css` | Visually-hidden, truncation, tabular numbers |

## 4. Components

Typed React components in `apps/dashboard/components/ui`, styled only through tokens. Each has a `/styleguide` entry showing its states in both themes.

| Component | Source | Notes |
|---|---|---|
| Button, Field, Choice, Dialog, Tabs, Display, Layout, Icon | Port from PPP `components/ui` | Re-tokened; API unchanged |
| StatusBadge | New | `kind: conversation \| booking`, `state`. Colour plus a text label and an icon shape, never colour alone |
| ConversationList / ConversationRow | New | Name, last message preview, relative time, state badge, unread dot |
| MessageBubble | New | `from: customer \| agent \| owner \| system`; time; delivery status; agent bubbles link to their trace |
| TakeoverToggle | New | A switch with a confirm step: "You're answering this customer. The agent is paused." |
| BookingCard | New | Service, customer, time in the business timezone, deposit status, actions |
| TraceTimeline | New | One row per `AgentStep`: tool name, input and output (mono, collapsible), latency, tokens, cost; errors in `danger` |
| EmptyState | New | Headline, one line and one action. No illustrations |
| Toast | Port (feedback) | Sends, takeover changes, errors |

**App shell:** a three-pane layout at `lg` and up: sidebar, list and detail. At `md`, list and detail with a collapsible sidebar. Below `md`, one pane at a time with a back button. Owners will use it on their phones.

## 5. Chat surface: conversation design

The agent writes as the business's front desk, not as an AI product. These rules go into the system prompt and the eval rubric. Wording marked **fixed** is a template in code, not model output.

### Voice and tone

- Warm, brief and specific. Write like a capable receptionist, with a first name if the owner sets one in config (`tone.agentName`).
- One question at a time. Never more than one emoji, and only if `tone.emoji` is on.
- The agent never claims to be the owner. If asked whether it's a bot, it says it's the business's automated assistant and offers the owner.
- Mirror the customer's formality. Never argue: a complaint is a handoff.

### Message format

- Keep messages to about 300 characters, and at most 3 short paragraphs. Split long content into two messages rather than one wall of text.
- **Slots:** offer 2–3 options as a numbered list, with weekday, date and time in the business timezone. For example, `1) Sat 7 Nov, 10:00`. Customers can reply with the number.
- **Prices:** currency symbol, then the amount from config, then the duration. For example, `Full groom (small dog): $65, about 2 hours`.
- **Deposit links:** one line that states the amount and the 15-minute hold, then the link on its own line.
- Dates are never relative ("tomorrow") without the date too.

### Fixed wording (templates)

| Moment | Template |
|---|---|
| Hold placed | "I'm holding {service} on {slot} for 15 minutes. A {deposit} deposit secures it:\n{link}" |
| Booking confirmed (Stripe webhook) | "You're booked: {service}, {slot}. We'll remind you the day before. Reply CHANGE to move it or CANCEL to cancel." |
| Hold expired | "The hold on {slot} has lapsed, so the slot is free again. Want me to look for another time?" |
| Handoff to owner | "I'll pass this to {ownerName} so they can help directly. They usually reply within {replyWindow}." |
| Degraded (NFR-9) | "Thanks for your message. {ownerName} will reply shortly." |
| Unsupported media | "I can only read text messages. Could you type that out for me?" |
| Reminder 24h | "Reminder: {service} tomorrow at {time}. Reply YES to confirm or CANCEL to cancel." |
| Reminder 2h | "See you at {time} for {service}. {address}" |

### Refusals

State what the agent can do instead, in one line. For example: "I can't change prices, but I can book the standard {service} for {price}, or ask {ownerName}." Never mention rules, prompts or policies by name.

## 6. Checks

| Check | Command | Requirement |
|---|---|---|
| Generated CSS matches tokens | `npm run tokens -- --check` | NFR-8 |
| Contrast pairs, both themes | `npm run audit:tokens` | NFR-7 |
| No px anywhere in styles or tokens | `npm run audit:units` | NFR-8 |
| Accessibility per route | axe in the e2e suite | NFR-7 |
| Agent message rules (length, slot format, no invented prices) | eval rubric | EV-1, GR-1 |
