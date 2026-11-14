# What Gmail gives us: data reference

Everything the Gmail API can return about a mailbox, how it's structured, what it costs, and which **default business rules** each piece of data supports.
Researched from the official Gmail API reference on 2026-11-13 (links at the bottom). Check the links again before changing scopes or quotas.

> Short version: for each email Gmail gives us **IDs, labels, a ~200-character snippet, timestamps, size, every header** (From/To/Cc/Subject/Message-ID/In-Reply-To/List-Unsubscribe/…), and, with the `full` format, **the body (plain text + HTML) and the attachment list** (names, types, sizes). Attachment *contents* need one extra call each. On top of that: threads, labels with unread counts, the account profile, and a change history for incremental sync.

---

## 1. The calls that matter

| Call | Returns | Quota cost* |
|---|---|---|
| `users.getProfile` | email address, total messages, total threads, current `historyId` | 1 |
| `users.messages.list` (`q`, `labelIds`, `maxResults ≤ 500`, `pageToken`, `includeSpamTrash`) | only `{ id, threadId }` per message, plus `nextPageToken`, `resultSizeEstimate` | 5 |
| `users.messages.get` | one message in a chosen **format** (see §2) | 20 (60 for `full`/`raw`) |
| `users.messages.attachments.get` | one attachment's bytes (base64url) | 20 |
| `users.threads.list` / `threads.get` | thread IDs / all messages of a thread | 10 / 40 (120 for `full`) |
| `users.labels.list` / `labels.get` | all labels / one label with counts | 1 |
| `users.history.list` (`startHistoryId`, `historyTypes`) | what changed since a point in time (incremental sync) | 2 |

\*Quota: **6,000 units per user per minute**, 1,200,000 per project per minute.
Our current sync (300 × `messages.get` with `metadata` = 6,000 units) uses a user's **whole minute budget**. With `full` it would take ~3 minutes. Throttle, or use incremental sync (§6).

`q` takes Gmail search syntax (`newer_than:30d -category:promotions from:x@y.com has:attachment`). **It can't be used with the `gmail.metadata` scope.**

## 2. Message formats: how much you get per email

| `format` | You get | Body? | Works with `gmail.metadata` scope? |
|---|---|---|---|
| `minimal` | `id`, `threadId`, `labelIds`, `snippet`, `historyId`, `internalDate`, `sizeEstimate` | no | yes |
| `metadata` | the above + **headers** (all, or only the ones listed in `metadataHeaders`) | no | yes |
| `full` | the above + the **parsed MIME tree** in `payload` (bodies + attachment list) | **yes** | **no** (needs `gmail.readonly`) |
| `raw` | the whole RFC 2822 email as one base64url string in `raw` | yes (unparsed) | no |

**What we use (since 2026-11-14):** `format=full` for every message in the window, scope `gmail.readonly`. See §9 for exactly what we store.

## 3. The Message object

```ts
Message {
  id: string                 // immutable message ID
  threadId: string           // conversation it belongs to
  labelIds: string[]         // e.g. ["INBOX","UNREAD","IMPORTANT","CATEGORY_PERSONAL"] (see §5)
  snippet: string            // short plain-text excerpt (~200 chars) of the body
  historyId: string          // last change to this message (for incremental sync)
  internalDate: string       // epoch ms Gmail received it (use this for ordering, not the Date header)
  sizeEstimate: number       // bytes
  payload: MessagePart       // the MIME tree (headers always; bodies only with format=full)
  raw?: string               // only with format=raw
  classificationLabelValues? // Google Workspace classification labels (rarely used)
}

MessagePart {
  partId: string             // "" for the root, then "0", "1", "1.0", …
  mimeType: string           // "multipart/alternative", "text/plain", "text/html", "application/pdf", "text/calendar", …
  filename: string           // set only when the part is an attachment
  headers: { name, value }[] // the root part carries the email headers (§4)
  body: MessagePartBody
  parts?: MessagePart[]      // children, for multipart/* containers
}

MessagePartBody {
  size: number               // bytes of the decoded data
  data?: string              // base64url content (small parts: the text bodies)
  attachmentId?: string      // set instead of data for attachments → fetch with attachments.get
}
```

### Example (`format=full`, fictional data)

```json
{
  "id": "18c2f9a1b2c3d4e5",
  "threadId": "18c2f0aa11bb22cc",
  "labelIds": ["INBOX", "UNREAD", "IMPORTANT", "CATEGORY_PERSONAL"],
  "snippet": "Hi Maya, following up on invoice #1042. Could you confirm the payment date? Thanks, Tom",
  "historyId": "4421337",
  "internalDate": "1763030400000",
  "sizeEstimate": 48213,
  "payload": {
    "partId": "",
    "mimeType": "multipart/mixed",
    "headers": [
      { "name": "From", "value": "Tom Reyes <tom@reyesbuild.example>" },
      { "name": "To", "value": "Maya Chen <maya@northwind.example>" },
      { "name": "Cc", "value": "accounts@reyesbuild.example" },
      { "name": "Subject", "value": "Re: Invoice #1042" },
      { "name": "Date", "value": "Thu, 13 Nov 2026 09:20:00 +0100" },
      { "name": "Message-ID", "value": "<CAF=abc123@mail.reyesbuild.example>" },
      { "name": "In-Reply-To", "value": "<CAG=xyz789@mail.northwind.example>" },
      { "name": "References", "value": "<CAG=xyz789@mail.northwind.example>" }
    ],
    "body": { "size": 0 },
    "parts": [
      {
        "partId": "0", "mimeType": "multipart/alternative", "filename": "", "body": { "size": 0 },
        "parts": [
          { "partId": "0.0", "mimeType": "text/plain", "filename": "", "body": { "size": 212, "data": "SGkgTWF5YSwgZm9sbG93aW5nIHVw…" } },
          { "partId": "0.1", "mimeType": "text/html",  "filename": "", "body": { "size": 640, "data": "PGRpdj5IaSBNYXlhLC…" } }
        ]
      },
      {
        "partId": "1", "mimeType": "application/pdf", "filename": "Invoice-1042.pdf",
        "headers": [{ "name": "Content-Disposition", "value": "attachment; filename=\"Invoice-1042.pdf\"" }],
        "body": { "size": 45210, "attachmentId": "ANGjdJ8…" }
      }
    ]
  }
}
```

Reading it: the plain-text body is the `text/plain` part (base64url-decode `data`), the HTML version sits next to it, and the PDF is an attachment we know by name, type and size **without downloading it**.

## 4. Headers: what's in them and why we care

Headers come back in `payload.headers`. With `format=metadata`, ask only for the ones you need via `metadataHeaders`.

| Header | Contains | Use for us |
|---|---|---|
| `From`, `Sender`, `Reply-To` | who wrote it (name + address) | contact, external vs internal, direction |
| `To`, `Cc`, `Bcc`* | recipients (*Bcc only on mail you sent) | participants, "you were only Cc'd", group threads |
| `Delivered-To` | the mailbox it landed in | aliases / shared inboxes |
| `Subject` | subject | display, keyword rules ("invoice", "proposal") |
| `Date` | sender's claimed send time | display only (prefer `internalDate`) |
| `Message-ID`, `In-Reply-To`, `References` | message identity + what it replies to | exact reply chains, response times |
| `List-Unsubscribe`, `List-Id`, `Precedence: bulk/list` | newsletter / mailing list markers | exclude newsletters from "people" metrics |
| `Auto-Submitted`, `X-Autoreply`, `X-Autorespond` | auto-replies (out of office) | don't count as a real reply |
| `Return-Path` | bounce address | detect bounces / no-reply senders |
| `Content-Type` (root) | `multipart/mixed` usually means attachments | cheap "has attachment" hint without `full` |
| `Authentication-Results`, `Received-SPF`, `DKIM-Signature` | sender authentication | (later) trust / phishing signals |
| `Received` (many) | delivery hops | rarely useful; skip |

## 5. Labels: the free signals

`labelIds` on every message, even with `minimal`:

| Label | Meaning |
|---|---|
| `INBOX`, `SENT`, `DRAFT`, `SPAM`, `TRASH` | where it is (SENT = you wrote it) |
| `UNREAD` | not read yet |
| `STARRED` | user starred it (a human "follow up" signal) |
| `IMPORTANT` | Gmail's own importance guess |
| `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS` | Gmail's tab classification |
| `Label_123…` | user-created labels (names via `labels.list`) |

`labels.list`/`labels.get` also give `messagesTotal`, `messagesUnread`, `threadsTotal`, `threadsUnread` per label: inbox-wide counts in one cheap call (1 unit), with no need to sync every message.

## 6. Threads, profile, history

- **Thread** (`threads.get`): `{ id, snippet, historyId, messages: Message[] }`. One call returns the whole conversation in order, the natural unit for "waiting on you / them".
- **Profile** (`getProfile`): `emailAddress`, `messagesTotal`, `threadsTotal`, `historyId`. Store the `historyId` after a full sync.
- **History** (`history.list?startHistoryId=…`): records of `messagesAdded`, `messagesDeleted`, `labelsAdded`, `labelsRemoved` since that point, 2 units per page. This is how sync becomes cheap and near-live: full sync once, then only fetch changes. If the ID is too old (usually valid ≥ 1 week, sometimes only hours) the API returns **404**, and you run a full sync again.
- **Push** (later): `users.watch` sends Pub/Sub notifications on change, then you call `history.list`.

## 7. What we can compute (derived, no AI needed)

| Derived field | From |
|---|---|
| direction (in / out) | `SENT` label or From = account |
| is unread / starred / important / category | `labelIds` |
| internal vs external | sender domain vs account domain |
| is newsletter / bulk | `List-Unsubscribe`, `List-Id`, `Precedence`, `CATEGORY_PROMOTIONS/UPDATES` |
| is auto-reply / no-reply | `Auto-Submitted`, `X-Autoreply`, sender address pattern |
| has attachments, attachment names/types/sizes | `full`: parts with `filename`; `metadata`: `Content-Type: multipart/mixed` as a hint |
| meeting invite | a `text/calendar` part (`invite.ics`) |
| reply chain + response time | `Message-ID` / `In-Reply-To` + `internalDate` |
| waiting on you / them, days waiting | last message's direction + `internalDate` per thread |
| thread size, participants | `threads.get`, To/Cc |
| first contact (new person) | first time a sender address appears |
| busiest hours / days | `internalDate` histogram |
| top companies | sender domains |

## 8. Default business rules → what each needs

These are deterministic rules we can ship as default widgets before any agent exists. ✅ = already in the app.

| # | Rule / widget | Needs | Format |
|---|---|---|---|
| 1 | ✅ Waiting on your reply (last message is theirs, excl. automated) | direction, internalDate, sender pattern | metadata |
| 2 | ✅ Waiting on their reply (you wrote last, ≥ 3 days) | same | metadata |
| 3 | ✅ Received / sent / people / activity per day / top people | same | metadata |
| 4 | Unread important (`UNREAD` + `IMPORTANT`, not newsletters) | labels, List-* headers | metadata |
| 5 | Starred = your own follow-up list | `STARRED` | minimal |
| 6 | New contacts this week (first-time external senders) | From, history of senders | metadata |
| 7 | Your average reply time / their reply time | Message-ID, In-Reply-To, internalDate | metadata |
| 8 | Newsletter & notification load (and who sends the most) | List-Unsubscribe / Precedence / categories | metadata |
| 9 | Emails with attachments, e.g. invoices / contracts / quotes by filename or PDF type | attachment parts | **full** |
| 10 | Meeting invites received | `text/calendar` part | **full** |
| 11 | Top companies (domains) you talk to | From/To domains | metadata |
| 12 | Threads where you're only Cc'd (lower priority) | To vs Cc | metadata |
| 13 | Busiest hours/days heatmap | internalDate | minimal |
| 14 | Inbox health: unread totals per label | `labels.get` counts | (label call) |
| 15 | Keyword rules on subject ("invoice", "proposal", "urgent") | Subject | metadata |
| 16 | Keyword rules on body text | body | **full**, plus a storage decision |

Rules 1–8 and 11–15 work with **metadata only** (cheaper, less sensitive). Rules 9, 10 and 16 need `full`.

## 9. What we store today vs. what we should store

**Implemented** (`server/gmail-parse.js` → `messages` collection). Inspect real stored data with `GET /api/messages?limit=10` and `GET /api/messages/<gmailId>` (includes the decrypted body):

```ts
{
  gmailId, threadId, historyId, internalDate, sizeEstimate,
  labelIds, isUnread, isStarred, isImportant, category,          // from labels
  direction, isInternal, isAutomated, isBulk,                    // derived
  from: { name, email, domain }, replyTo?, to: Address[], cc: Address[],
  subject, snippet,
  messageId, inReplyTo?, references: string[],                   // reply chains
  listUnsubscribe?, autoSubmitted?,
  attachments: { filename, mimeType, size, attachmentId }[],     // full format only
  hasCalendarInvite,                                             // full format only
  bodyEnc: string,     // plain-text body, first 20,000 chars, AES-256-GCM encrypted
  headers: { name, value }[], // every top-level header as Gmail sent it
  sentAt, deliveredTo, bcc, listId, precedence, contentType, hasHtml, bodyTruncated,
  source: "gmail" | "sample", syncedAt
}
```

Plus a `labels` collection (id, name, type, total/unread counts) and on the connection: `historyId`, `mailbox.messagesTotal/threadsTotal`, `syncProgress`.

```ts
// (canonical shape above)
}
```

## 10. Limits, privacy, decisions

- **Scopes:** `gmail.readonly` and `gmail.metadata` are both **restricted** scopes. Public launch needs Google OAuth verification and possibly a security assessment. Testing mode with listed test users is fine for the hackathon.
- **Bodies are the sensitive part.** The blueprint says to minimise them: fetch only when needed, store excerpts or derived fields, and keep a retention period. Body text is also **untrusted input** (prompt injection) once the agent reads it.
- **Attachments:** listing names/types needs `full`; downloading contents needs `attachments.get` (20 units each). Don't download by default.
- **Quota:** at 6,000 units/user/minute we must throttle (and later move to `history.list`).

**Decided 2026-11-14** (see `decisions.md` #16–18): fetch everything with `full`, store the body encrypted, pace under the quota, and use `history.list` for label changes. The options considered were:

1. Sync with `metadata` + a wider header list (cheap, enough for rules 1–8 and 11–15), or `full` (adds attachments, invites, body rules; ~3× quota)?
2. Store body text? If yes: truncated, plain text only, with a retention period.
3. Move to incremental sync (`history.list`) now or after the demo?

All data in §8 is fetched. The 14 implemented rules (Gmail fields only, no keyword or text inference) are in [business-rules.md](business-rules.md). Keyword/text rules (8.9, 8.15, 8.16) are left to the agent, labelled as inferred.

---

### Sources

- Messages resource: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages
- Formats: https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format
- messages.list (q, maxResults ≤ 500, q not allowed with metadata scope): https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- Attachments / MessagePartBody: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments
- Threads: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get
- Labels: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels · system labels: https://developers.google.com/workspace/gmail/api/guides/labels
- Profile: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile
- History (incremental sync, 404 on old IDs): https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- Scopes and sensitivity: https://developers.google.com/workspace/gmail/api/auth/scopes
- Quota units: https://developers.google.com/workspace/gmail/api/reference/quota
