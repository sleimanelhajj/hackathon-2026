---
version: 1
slug: "src-index-css"
primary_target: "src/index.css"
related_targets: ["src/App.tsx"]
---

Scope: the whole app shell and its working screens (Dashboard, Email data, Integrations, reply dialog). Mode: Operate.

Audience and job: founders, SMB operators and sales reps triaging Gmail at a desk, daily. Task first: see what needs them, reply, find emails. Constraints: AA contrast, honest sync state, no new layout or controls; the world lends palette, material, density and one move.

## Direction contract

THESIS: Work panes float like frosted glass over an open sky. Refuses the grey-card SaaS default and decorative glass: glass marks the layers you work on, nothing else.

OWN-WORLD: Sky ground from cloudy white (#e8f3fc) to clear blue (#9ccbee) with soft white cloud masses. Panes rgba(255,255,255,.62), 18px blur, white top-edge highlight, navy-tinted soft shadows. Sky-blue primary #0369a1 for every action; amber-red #ef5a1c (text #b13a0b) only for urgency. Inter, tabular numerals.

STORY: The visitor sees the sky, then the panes, then the amber-red counts that need them; everything clickable is sky blue.

FIRST VIEWPORT: Glass sidebar left; dashboard title and Sync/Edit actions top right; the reply callout with its sky-blue primary button; four stat panes, amber-red where something waits on them; AI attention list and category pane below.

FORM: Pinned by the user. seed: none (pinned) — "update the UI to glassmorhpic and use sky blue, cloudy white, amber red accents". Signature move: clouds drift only while a sync or AI run is really working.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
