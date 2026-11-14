# Project Context — AI Workspace OS (AlphaHack 2026)

This folder is the single source of truth for **what we are building, why, and what has been decided**.
Read this first before contributing (humans and AI assistants alike).

| File | What it holds |
|---|---|
| [README.md](README.md) | This overview: idea, scope, status |
| [product-blueprint.md](product-blueprint.md) | Full PRD / architecture / MVP plan (the original idea document) |
| [roadmap.md](roadmap.md) | **What to build next, in order, how, and with which packages** (drag-and-drop, agent, drafts, RBAC, …) |
| [agent-plan.md](agent-plan.md) | Build plan for the agent (roadmap #2, Gemini): tools, safety, streaming, chat panel, eval prompts |
| [decisions.md](decisions.md) | Log of decisions made so far and open questions |
| [tech-stack.md](tech-stack.md) | Libraries, tools, and project setup |

---

## The idea in one line

**Connect your tools. Describe what matters. Get a personalized, continuously updated dashboard that understands your work and helps you act on it.**

> **Focus after the AlphaHack feedback (2026-11-14):** one person (a sales rep), one tool (Gmail), one trigger (no reply after 3 business days). Details in [Target user](#target-user-one-person) and [Definitions](#definitions-decided-before-building). Decisions #23–#26.

## Problem

A sales rep's day runs through Gmail: proposals go out, invoices get chased, customers ask where their shipment is. Replies that never come, or questions that sit unanswered, get lost in long threads, and the rep only notices when a deal goes cold or a customer complains.

## Solution

An AI-powered workspace layer that:

1. **Connects** Gmail (the only source for the hackathon weekend; Google Calendar comes after).
2. **Understands** the data: finds proposals, invoices and shipments that need a follow-up, with source links.
3. **Visualizes** it — generates a dashboard from a natural-language request.
4. **Answers** questions about the data with citations.
5. **Acts** — drafts follow-ups/tasks, but only executes after explicit user approval.
6. **Monitors** — refreshes data and shows honest "last synced" status.

Core loop: `Connect → Understand → Visualize → Ask → Act → Monitor`

## Target user: one person

**A sales rep who sells and follows up from Gmail.** They send proposals and quotes, chase payments on invoices, and answer customers asking about shipments. That gives three kinds of email we care about, all in one inbox:

| Kind | Example | Follow-up the rep needs |
|---|---|---|
| **Proposals** | Quote sent, customer asks about terms | Nudge a prospect who went quiet; answer a question on a deal |
| **Invoices (accounting)** | Invoice sent, payment date unclear | Chase an overdue or disputed payment |
| **Shipments** | Customer asks where their order is; carrier says it's delayed | Reply to the customer; chase the carrier or warehouse |

Not for the weekend: founders, operators, whole teams, CRMs, WhatsApp or any channel other than Gmail.

## Definitions (decided before building)

One sentence each, as the feedback asked. The code implements these exactly in `shared/followup.js` (decisions #25–#27). The AI only decides what *kind* of email a thread is; the priority comes from these rules.

- **No reply:** a thread has "no reply" when the last message is one *you* sent to someone outside your company (not an automated address) and **3 business days** (Mon–Fri) have passed without an answer.
- **High priority:** a customer is waiting on *you* (they wrote last) about a proposal, a payment, a delivery or a new inquiry.
- **Medium priority:** a proposal, invoice or shipment you sent has had no reply for 3+ business days, or a customer is waiting on you about a meeting or a smaller request.
- **Low priority:** automated or on-track updates (shipping notifications, receipts, newsletters), internal or personal threads, or something you sent less than 3 business days ago.
- **The trigger (one):** a proposal, invoice or shipment thread crosses one of the lines above, so it appears in "Needs a follow-up" with a drafted reply that waits for the rep's approval. Nothing is ever sent automatically.

## Non-negotiable product principles

- **AI proposes structured JSON specs; deterministic code renders them.** Never execute model-written code or raw SQL.
- **Evidence before confidence.** Every insight links back to its source email/record.
- **Label certainty:** every fact is *observed*, *derived*, *inferred*, or *unknown*.
- **Human approval for consequential actions.** Drafting is fine; sending/mutating needs approval.
- **No fabricated metrics.** If the data isn't there, show "missing", don't guess.
- **Email content is untrusted data** (prompt-injection defense).

## Hackathon MVP (P0) — the demo we must land

1. Gmail OAuth connection with connected-state UI.
2. Bounded import of messages/threads, deduplicated.
3. AI sorting of proposals, invoices and shipments, with the priority rules above, the reason, and source links.
4. Dashboard generated from a prompt (KPI cards, table/action list, chart).
5. Conversational edits ("only last 14 days", "move follow-ups to top") that persist.
6. Q&A over synced data with citations.
7. Approval-gated Gmail **draft** creation (never auto-send).
8. Manual/scheduled refresh showing updated data.

**After the weekend:** Google Calendar connector + upcoming-meetings widget.

**Out of scope:** WhatsApp and every channel other than Gmail, many connectors, auto-sending email, replacing a CRM or accounting tool (we only read emails about invoices, we never touch the books), carrier tracking APIs, enterprise roles, arbitrary code generation.

## Demo story (short)

Blank workspace → connect Gmail → *"I'm a sales rep. Show me proposals, invoices and shipments that need a follow-up this month"* → dashboard appears → *"only high priority"* → *"why is the Reyes invoice high priority?"* (Tom asked to confirm a payment date and has been waiting on you for a week, with a link to the thread) → *"draft a follow-up"* → rep edits and approves → Gmail draft created with a confirmed link. Nothing is sent automatically.

## Current status

- ✅ Repo + React/Vite/TypeScript scaffold with dashboard libraries installed.
- ✅ Figma UI design: [AI Workspace OS — UI](https://www.figma.com/design/XTZ64s5ZqMsk2ARqPw1C2h). Screens: onboarding, member dashboard + agent, edit layout (drag & drop), draft approval modal, admin RBAC & tailoring, action center, integrations. Product record: [../PRODUCT.md](../PRODUCT.md).
- ✅ Backend: Node + Express + MongoDB Atlas. Gmail OAuth (read-only), bounded sync, sample-data mode.
- ✅ Drag-and-drop dashboard saved as a validated spec.
- ✅ AI email analysis with Gemini: sorts threads into proposals, invoices, shipments and more, with the reason and a next step. Priority follows the definitions above (business days included), and every row says which rule applied. The sample data covers all three kinds. See roadmap #4.
- 🟡 Auto-sync every 15 min for a live Gmail connection: built, not yet run on a real inbox. See roadmap #7.
- Next: the agent chat (roadmap #2, [agent-plan.md](agent-plan.md)), then approval-gated drafts (#5).
