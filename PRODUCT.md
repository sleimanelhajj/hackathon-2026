# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 + Vite + TypeScript (user decision: "React only", no Next.js). Libraries: react-grid-layout, @dnd-kit/react, @xyflow/react, recharts, @tanstack/react-query, zustand, zod, @assistant-ui/react. Backend: Node + Express, MongoDB Atlas. LLM: Google Gemini (`@google/genai`).

## Users

- **Super admin** — owns the workspace. Connects tools, manages RBAC (grants access to anyone), and **tailors a dashboard for each specific person**.
- **Admin** — manages access via RBAC within what the super admin allows.
- **Member (end user)**: for the hackathon, **a sales rep** (see below). Receives a dashboard tailored for them, then customizes it themselves through the **agentic chat layer** and by **dragging and dropping components**.

**The one person we build for (AlphaHack feedback, 2026-11-14):** a sales rep who sells and follows up from Gmail: proposals and quotes, invoices waiting on payment, and customers asking about shipments. Gmail only for the weekend; no WhatsApp, CRM or accounting tool. Founders, operators and whole teams come later. Definitions of "no reply" and priority are in `context/README.md`.

## Product Purpose

Connect business tools, describe what matters in plain language, and get a dashboard that understands the work and helps act on it. Loop: Connect → Understand → Visualize → Ask → Act → Monitor. Success for the demo: blank workspace → Gmail connected → the rep sees which proposals, invoices and shipments need a follow-up and why → edits the view conversationally → approves a drafted Gmail follow-up. Nothing is sent automatically.

## Positioning

Goal-to-workspace: a natural-language request produces a working, source-backed dashboard, and the dashboard can propose actions that run only after human approval. Admins can author dashboards for others; each person can still reshape their own.

## Operating Context

Daily use at a desk: the rep opens the dashboard to see who is waiting on them and who hasn't replied, across proposals, invoices and shipments, all from Gmail (Google Calendar after the hackathon). Admin setup happens occasionally; members return daily.

## Capabilities and Constraints

- RBAC: super admin, admin, member roles; per-person tailored dashboards.
- Members customize via agent chat and drag-and-drop widget grid.
- Widgets (P0): KPI card, action list, smart table, line/bar chart, insight card, meeting list.
- Dashboards are validated JSON specs rendered by fixed components; no model-authored code.
- Every fact is labeled observed / derived / inferred / unknown, with a source link.
- External actions (Gmail draft) require explicit approval; MVP is draft-only, never auto-send.
- Sync status must be honest ("last synced"), never claimed real-time without a real event path.
- Backend: Node + Express with MongoDB Atlas. LLM: Google Gemini (server-side only).
- Undecided: final brand.

## Brand Commitments

Name: **AI Workspace OS** (confirmed by user for the UI).

Visual direction: **category standard, played straight** (user choice, 2026-11-13). A clean, conventional SaaS workspace held to the craft bar of Linear, Attio and HubSpot. No novelty world.

## Evidence on Hand

No real customers, metrics, testimonials or pilot results exist. All numbers in designs are mock data and must not be presented as findings. Full idea doc: `context/product-blueprint.md`.

## Product Principles

1. Evidence before confidence — every insight traces to a source.
2. Human approval for consequential actions.
3. Admin tailors, person owns — tailored defaults, personal control.
4. No fabricated metrics; show missing data honestly.
5. Natural language first, structured configuration underneath.
