# Project Context — AI Workspace OS (AlphaHack 2026)

This folder is the single source of truth for **what we are building, why, and what has been decided**.
Read this first before contributing (humans and AI assistants alike).

| File | What it holds |
|---|---|
| [README.md](README.md) | This overview: idea, scope, status |
| [product-blueprint.md](product-blueprint.md) | Full PRD / architecture / MVP plan (the original idea document) |
| [decisions.md](decisions.md) | Log of decisions made so far and open questions |
| [tech-stack.md](tech-stack.md) | Libraries, tools, and project setup |

---

## The idea in one line

**Connect your tools. Describe what matters. Get a personalized, continuously updated dashboard that understands your work and helps you act on it.**

## Problem

Business information is scattered across Gmail, calendars, spreadsheets, CRMs and chat tools. People manually hunt for updates, copy data into trackers, rebuild dashboards, and lose follow-ups in long email threads.

## Solution

An AI-powered workspace layer that:

1. **Connects** existing apps (Gmail first, Google Calendar second).
2. **Understands** the data — extracts leads, follow-ups, tasks, deadlines with source links.
3. **Visualizes** it — generates a dashboard from a natural-language request.
4. **Answers** questions about the data with citations.
5. **Acts** — drafts follow-ups/tasks, but only executes after explicit user approval.
6. **Monitors** — refreshes data and shows honest "last synced" status.

Core loop: `Connect → Understand → Visualize → Ask → Act → Monitor`

## Target user (beachhead)

Founders, small-business operators and sales teams who run their business through Gmail.

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
3. AI extraction of leads, follow-ups, tasks — with source links.
4. Dashboard generated from a prompt (KPI cards, table/action list, chart).
5. Conversational edits ("only last 14 days", "move follow-ups to top") that persist.
6. Q&A over synced data with citations.
7. Approval-gated Gmail **draft** creation (never auto-send).
8. Manual/scheduled refresh showing updated data.

**Stretch:** Google Calendar connector + upcoming-meetings widget.

**Out of scope:** many connectors, auto-sending email, CRM/invoicing, enterprise roles, arbitrary code generation.

## Demo story (short)

Blank workspace → connect Gmail → *"I'm a sales manager, build me a dashboard of prospects, unanswered proposals and follow-ups for the past month"* → dashboard appears → *"show only high-priority, group leads by week"* → *"which proposals need a follow-up and why?"* → *"draft a follow-up to this prospect"* → user approves → Gmail draft created with confirmed link.

## Current status

- ✅ Repo + React/Vite/TypeScript scaffold with dashboard libraries installed.
- ✅ Figma UI design: [AI Workspace OS — UI](https://www.figma.com/design/XTZ64s5ZqMsk2ARqPw1C2h). Screens: onboarding, member dashboard + agent, edit layout (drag & drop), draft approval modal, admin RBAC & tailoring, action center, integrations. Product record: [../PRODUCT.md](../PRODUCT.md).
- ⏳ No backend yet (needed for OAuth, LLM calls, DB).
- ⏳ UI is a placeholder page.
- Next: build the dashboard shell + widget renderer on mock data, then add backend + Gmail.
