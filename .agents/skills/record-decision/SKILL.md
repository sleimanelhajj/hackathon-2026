---
name: record-decision
description: Log a product, architecture, scope, permission or design decision in context/decisions.md and keep the context docs current, so teammates and agents share the same picture. Use after any decision that changes scope, data access, stack, or UI direction, and when an open question gets answered.
---

# Record a decision

The `context/` folder is the team's shared memory. If it isn't written there, the next person (or agent) won't know it.

## When

- Scope changes (new connector, a feature moved in or out of the MVP)
- New data access (OAuth scope, a new collection, stored fields, retention)
- Stack changes (a new dependency, service, env var or route)
- Design direction or a new pattern
- An open question in `context/decisions.md` gets answered

## How

1. Add a row to the table in `context/decisions.md`, numbered after the highest existing number:
   `| N | YYYY-MM-DD | **Decision** in one line | Why (one line) |`
   Use an absolute date. Don't rewrite old rows; if a decision is reversed, add a new row that says so.
2. Tick or remove the matching item under **Open questions**.
3. Update the doc the decision affects:
   - stack, routes, env vars, collections → `context/tech-stack.md`
   - current status or scope → the "Current status" section of `context/README.md`
   - users, roles, principles, brand → `PRODUCT.md`
4. Mention the decision in the commit message body.

Never put secrets, personal data or real customer information in these docs.
