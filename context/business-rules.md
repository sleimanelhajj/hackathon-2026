# Default business rules

14 rules computed in `server/dashboard.js` from synced Gmail data (last 30 days). **Nothing is inferred:** every rule reads fields Gmail returned (labels, headers, addresses, attachments, dates). There is no keyword guessing on email text and no AI. (Keyword rules for invoices, contracts and urgent were removed on 2026-11-14; reading meaning from text is the agent's job, labelled as inferred.) Each one is available as a dashboard widget, and every widget shows how it was counted.
Rule ids, titles and "how" texts live in `shared/spec.js` (`LIST_RULES`, `BREAKDOWN_RULES`, `STAT_LABELS`).

Shared definitions:
- **Person** = not automated (no-reply, auto-reply headers) and not bulk (unsubscribe link, mailing list, Promotions/Social/Updates/Forums tab).
- **Lists show one row per conversation** (the newest matching email), newest first.
- Sample values below come from the built-in sample data (31 fictional emails).

## Conversations

| # | Rule | Rule id | What counts | Sample |
|---|---|---|---|---|
| 1 | Waiting on your reply | `awaitingYou` | Conversations where a person wrote last and you were in To (not Cc-only, not a calendar invite) | 7 |
| 2 | Waiting on their reply | `awaitingThem` | Conversations where you wrote last 3+ days ago | 4 |

## Lists (each also available as a number)

| # | Rule | Rule id | What counts | Sample |
|---|---|---|---|---|
| 3 | Unread and important | `unreadImportant` | Received, unread, marked Important by Gmail, not bulk | 4 |
| 4 | Starred | `starred` | Emails you starred | 1 |
| 5 | New contacts this week | `newContacts` | External people whose first email with you (either direction) is in the last 7 days | 3 |
| 6 | Emails with attachments | `attachments` | Received with real attachments (inline images and `.ics` invites left out) | 1 |
| 7 | Meeting invites | `meetingInvites` | Has a calendar invite attachment (`text/calendar` / `.ics`) | 1 |
| 8 | You're only Cc'd | `ccOnly` | From a person; you're in Cc but not in To | 1 |

## Timing

| # | Rule | Rule id | What counts | Sample |
|---|---|---|---|---|
| 9 | Your reply time | `yourReplyHours` | Median time from a person's email to your reply (matched by `In-Reply-To`, else thread order) | 24 h |
| 10 | Their reply time | `theirReplyHours` | Median time from your email to a person's reply | 3.0 days |

## Breakdowns

| # | Rule | Rule id | What counts | Sample |
|---|---|---|---|---|
| 11 | Newsletters and notifications | `newsletters` | Bulk senders ranked by number of emails (also a number: total bulk emails) | Product Digest 4, CloudPay 2, SaaS Summit 2 |
| 12 | Top companies | `topDomains` | External sender domains (people only) ranked by emails | brightpath 3, liuventures 2 |
| 13 | When email arrives | `busiestHours` | Emails from people per hour of day (server time zone) | peaks at 16:00–17:00 |
| 14 | Unread by label | `labels` | Gmail's own unread count per label, whole mailbox | Inbox 9, Clients 5 |

Plain counts are also available as numbers: **received**, **sent**, **people** (distinct people who wrote to you).

## Adding or changing a rule

- A new default rule: follow the `add-dashboard-widget` skill. Compute it in `server/dashboard.js`, register its id/title/how in `shared/spec.js`, and add an example to `server/sample.js` so the sample data exercises it.
- Rules the agent creates for a user are **custom rules** (JSON DSL), not code. See [agent-gmail.md](agent-gmail.md) §4.
- Default rules must only read Gmail fields. Anything that needs to understand the text (is this an invoice? is it urgent?) belongs to the agent and must be shown as *inferred*.
