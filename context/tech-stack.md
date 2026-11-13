# Tech Stack & Setup

## Frontend (installed)

| Package | Used for |
|---|---|
| `react`, `react-dom` | UI framework (React 19) |
| `vite`, `@vitejs/plugin-react` | Dev server and build |
| `typescript` | Type safety |
| `react-grid-layout` | Draggable / resizable dashboard widget grid |
| `@dnd-kit/react` | Drag-and-drop (lists, action queue reordering) |
| `@xyflow/react` | Node/flow diagrams (e.g. workflow/automation builder, data-flow views) |
| `recharts` | Charts (KPI trends, bar/line/donut) |
| `@tanstack/react-query` | Server-state fetching, caching, refresh |
| `zustand` | Client state (dashboard spec, UI state) |
| `zod` | Schema validation of AI-generated dashboard/widget specs |
| `@assistant-ui/react` | Agent chat panel UI |

Exact versions are pinned in `package.json` / `package-lock.json`.

## Backend (not built yet — planned)

Per blueprint: one API server, one database, one Gmail adapter, one LLM orchestrator, one job worker.
Stack choice is an open question (see [decisions.md](decisions.md)).

## Project layout

```
.
├── context/            ← project idea, decisions, stack (you are here)
├── src/
│   ├── main.tsx        ← React entry, React Query provider
│   ├── App.tsx         ← placeholder page
│   └── index.css
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Running locally

```bash
npm install
npm run dev      # start dev server
npm run build    # type-check + production build
```

## Gotchas

- If `npm install` fails with `EBADDEVENGINES ... pnpm`, a stray `package.json` in a parent folder (e.g. your home directory) is being picked up. Run npm from inside this project folder, which has its own `package.json`.
- `.impeccable/` is a local plugin cache and is git-ignored.
