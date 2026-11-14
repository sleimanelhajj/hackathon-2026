# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 + Vite + TypeScript (user decision: "React only", no Next.js). Libraries: react-grid-layout, @dnd-kit/react, @xyflow/react, recharts, @tanstack/react-query, zustand, zod, @assistant-ui/react. Backend: Node + Express, MongoDB Atlas. LLM: Google Gemini (`@google/genai`).

## Users

- **Super admin** — owns the workspace. Connects tools, manages RBAC (grants access to anyone), and **tailors a dashboard for each specific person**.
- **Admin** — manages access via RBAC within what the super admin allows.
- **Member (end user)** — e.g. a founder, sales rep or operator. Receives a dashboard tailored for them, then customizes it themselves through the **agentic chat layer** and by **dragging and dropping components**.

Beachhead: founders, SMB operators and sales teams who run their business through Gmail.

## Product Purpose

Connect business tools, describe what matters in plain language, and get a dashboard that understands the work and helps act on it. Loop: Connect → Understand → Visualize → Ask → Act → Monitor. Success for the demo: blank workspace → Gmail connected → dashboard generated from a prompt → edited conversationally → source-backed insight → approved Gmail draft.

## Positioning

Goal-to-workspace: a natural-language request produces a working, source-backed dashboard, and the dashboard can propose actions that run only after human approval. Admins can author dashboards for others; each person can still reshape their own.

## Operating Context

Daily operational use at a desk: triaging leads, follow-ups, meetings and tasks extracted from Gmail (Google Calendar as stretch). Admin setup happens occasionally; members return daily.

## Capabilities and Constraints

- RBAC: super admin, admin, member roles; per-person tailored dashboards.
- Members customize via agent chat and drag-and-drop widget grid.
- Widgets (P0): KPI card, action list, smart table, line/bar chart, insight card, meeting list.
- Dashboards are validated JSON specs rendered by fixed components; no model-authored code.
- Every fact is labeled observed / derived / inferred / unknown, with a source link.
- External actions (Gmail draft) require explicit approval; MVP is draft-only, never auto-send.
- Assistant business answers come from a bounded, read-only company-data adapter with source links; the app's MongoDB is not treated as the company database.
- Invoice PDFs use verified customer/pricing records plus user-provided details. Totals are computed by code, and sending is available only after an editable human review and explicit approval.
- Sync status must be honest ("last synced"), never claimed real-time without a real event path.
- Backend: Node + Express with MongoDB Atlas. LLM: Google Gemini (server-side only).
- Undecided: final brand.

## Brand Commitments

Name: **AI Workspace OS** (confirmed by user for the UI).

Visual direction: **white and dark blue glass on grey** (user choice, 2026-11-14: "change the colors to white and dark blue and use glass morphism … have it have grey background … make the UI look good and clean for non tech users"). White frosted-glass panes over a soft grey ground; dark blue for actions; a calm amber only for warnings. Plain words, large controls. Layout, navigation and controls stay the category standard, held to the craft bar of Linear, Attio and HubSpot. Replaces the earlier sky-blue glass look (decision #33).

## Evidence on Hand

No real customers, metrics, testimonials or pilot results exist. All numbers in designs are mock data and must not be presented as findings. Full idea doc: `context/product-blueprint.md`.

## Product Principles

1. Evidence before confidence — every insight traces to a source.
2. Human approval for consequential actions.
3. Admin tailors, person owns — tailored defaults, personal control.
4. No fabricated metrics; show missing data honestly.
5. Natural language first, structured configuration underneath.
