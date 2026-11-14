// Follow-up rules for the hackathon persona: a sales rep following up on proposals, invoices and shipments.
// These implement context/README.md → "Definitions" (decisions #25–#26) and must stay word-for-word in sync with it.
// Pure functions, no I/O: used by the server (dashboard, AI analysis) and safe to use in the browser.
//
// - "No reply": you sent the last message, to someone outside your company (not an automated address),
//   and NO_REPLY_BUSINESS_DAYS business days (Mon–Fri) have passed without an answer.
// - High:   a customer is waiting on you (they wrote last) about a proposal, a payment or a delivery.
// - Medium: no reply for 3+ business days on a proposal, invoice or shipment,
//           or a customer is waiting on you about a meeting or a smaller request.
// - Low:    automated or on-track updates, internal or personal threads, or still inside the 3 business days.
//
// The AI only decides the *category* (inferred). Priority is *derived* here, at read time, because
// "3 business days" passes even when no new email arrives.

export const NO_REPLY_BUSINESS_DAYS = 3;

/** Sender/recipient addresses that are machines, not people. */
export const AUTOMATED_ADDRESS = /(no-?reply|do-?not-?reply|notifications?@|mailer-daemon|newsletter|bounce)/i;

/** The three kinds of email the persona follows up on (plus new inquiries, which become proposals). */
export const FOLLOW_UP_KINDS = ["lead", "proposal", "billing", "shipping"];
/** A customer waiting on you about these is medium, not high. */
const SMALLER_ASKS = ["request", "scheduling"];

const KIND_WORDS = { lead: "a new inquiry", proposal: "a proposal", billing: "a payment", shipping: "a delivery" };
const FREE_MAIL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|aol|proton|protonmail|gmx)\./i;

export const domainOf = (email = "") => email.split("@")[1]?.toLowerCase() ?? "";

/** All email addresses in a header like `"Lena Ortiz" <lena@x.example>, tom@y.example`. */
export function addressesIn(header = "") {
  return (header.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []).map((a) => a.toLowerCase());
}

/** Someone outside your company. With a personal address (gmail.com, …) anyone but you counts as outside. */
export function isExternal(email, selfEmail) {
  const e = (email ?? "").toLowerCase();
  const self = (selfEmail ?? "").toLowerCase();
  if (!e || e === self) return false;
  const selfDomain = domainOf(self);
  if (!selfDomain || FREE_MAIL.test(selfDomain)) return true;
  return domainOf(e) !== selfDomain;
}

/**
 * Whole business days (Mon–Fri) between two moments, counted by calendar date in UTC:
 * sent Friday → Monday is 1; sent Monday → Thursday is 3. Never negative.
 */
export function businessDaysBetween(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  if (!(end > start)) return 0;
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  let count = 0;
  for (let i = 0; i < 400 && day.getTime() < last; i++) {
    day.setUTCDate(day.getUTCDate() + 1);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Priority of one thread under the rules above.
 * `last`: the thread's latest message { direction: "in" | "out", from: { name, email }, to: header string, date }.
 * Returns { priority, rule, needsReply, waitingBusinessDays }; `rule` is the plain-English reason shown in the UI.
 */
export function followUpPriority({ category, last, selfEmail, now = Date.now() }) {
  const waitingBusinessDays = businessDaysBetween(last.date, now);
  const result = (priority, rule, needsReply = false) => ({ priority, rule, needsReply, waitingBusinessDays });

  if (category === "automated") return result("low", "Automated update, nothing to do");

  if (last.direction === "in") {
    const from = last.from?.email ?? "";
    const who = last.from?.name || from || "They";
    if (AUTOMATED_ADDRESS.test(from)) return result("low", "Automated update, nothing to do");
    if (!isExternal(from, selfEmail)) return result("low", "Internal thread");
    if (FOLLOW_UP_KINDS.includes(category)) return result("high", `${who} is waiting on you about ${KIND_WORDS[category]}`, true);
    if (SMALLER_ASKS.includes(category)) return result("medium", `${who} is waiting on you`, true);
    return result("low", "Not a sales follow-up");
  }

  // You wrote last.
  const toPeople = addressesIn(last.to).filter((a) => isExternal(a, selfEmail) && !AUTOMATED_ADDRESS.test(a));
  if (!toPeople.length) return result("low", "Internal thread");
  if (!FOLLOW_UP_KINDS.includes(category)) return result("low", "Not a sales follow-up");
  if (waitingBusinessDays >= NO_REPLY_BUSINESS_DAYS)
    return result("medium", `No reply for ${plural(waitingBusinessDays, "business day")}`);
  return result("low", `Sent ${plural(waitingBusinessDays, "business day")} ago; follow up after ${NO_REPLY_BUSINESS_DAYS}`);
}

/** "No reply" for the plain thread lists (no AI category needed). */
export function isNoReply({ last, selfEmail, now = Date.now() }) {
  if (last.direction !== "out") return false;
  const toPeople = addressesIn(last.to).filter((a) => isExternal(a, selfEmail) && !AUTOMATED_ADDRESS.test(a));
  return toPeople.length > 0 && businessDaysBetween(last.date, now) >= NO_REPLY_BUSINESS_DAYS;
}
