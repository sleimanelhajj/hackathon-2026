---
version: 1
slug: "src-index-css"
primary_target: "src/index.css"
related_targets: ["src/App.tsx"]
---

Scope: the whole app shell and its working screens (Dashboard, All email, Integrations, reply dialog, dropdowns). Mode: Operate.

Audience and job: founders, SMB operators and sales reps, many not technical, triaging Gmail at a desk daily. Task first: see what needs them, reply, find emails. Constraints: AA contrast, honest sync state, plain words, large controls; the world lends palette, material, density and one move.

## Direction contract

THESIS: Calm white glass on a soft grey desk, one dark blue for everything you can do. Refuses colourful dashboards and decorative glass: glass marks only the layers you work on.

OWN-WORLD: Grey ground #eef0f3 to #d5dae2 with soft white glows. Panes rgba(255,255,255,.72), 20px blur, white top-edge highlight, soft neutral shadows. Dark blue #1e3a8a for every action, link and selection; amber #d97706 (text #92400e) only for warnings. Inter, tabular numerals. Dropdowns are Radix Select with glass menus and 38px rows.

STORY: The visitor sees calm white panes, the amber counts that need them, and one blue for anything clickable; filters say in words what they show.

FIRST VIEWPORT: Glass sidebar left (Dashboard, All email, Integrations); dashboard title with Sync now / Edit layout top right; the reply callout with its dark-blue primary button; four stat panes, amber where something waits; AI attention list and topic pane below.

FORM: Pinned by the user. seed: none (pinned) — "change the colors to white ad dark blue and use glass morphism. when it uses glass morphisim have it have grey background". Signature move: the glows drift only while a sync or AI run is really working.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
