// The Schedule page (src/pages/SchedulePage.tsx): a calendar built from Gmail. Each item says why it's there and
// opens its email; syncing to Google Calendar needs calendar access and a confirmation.
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Availability, type MeetingRequest, type Schedule, type ScheduleItem } from "../src/lib/api";
import SchedulePage from "../src/pages/SchedulePage";
import { ConfirmHost, dismissConfirm } from "../src/components/ConfirmDialog";
import { Toaster, toast } from "../src/components/Toaster";
import { useViewer } from "../src/components/EmailViewer";
import { useReply } from "../src/components/ReplyModal";

beforeAll(() => {
  // jsdom has no layout; react-big-calendar measures with these.
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 900 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); act(() => { useViewer.getState().close(); useReply.getState().close(); dismissConfirm(); toast.clear(); }); });

const today = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const item = (extra: Partial<ScheduleItem>): ScheduleItem => ({
  id: "reply-t1", kind: "reply", priority: "high", title: "Reply to Kevin Elmurr", start: today(11, 40), end: today(12, 10),
  why: "Urgent: 2 hours after Kevin Elmurr's email arrived (Wed 11 Nov, 09:40).", threadId: "t1", link: "https://mail.google.com/mail/u/0/#all/t1",
  contact: "Kevin Elmurr", subject: "Quote for the inverter batteries", summary: "Kevin asks for a quote on 4 inverter batteries.",
  suggestedAction: "Send the quote", category: "proposal", overdue: false, dueAt: null, allDay: false, location: null, ...extra,
});
const schedule = (extra: Partial<Schedule> = {}): Schedule => ({
  connected: true, sample: false, timeZone: "Asia/Beirut", generatedAt: new Date().toISOString(), account: "me@shop.example",
  analysis: { status: "done", analysed: 12 },
  calendar: { canSync: true, name: "AI Workspace OS", lastSyncAt: null, syncedCount: 0 },
  items: [
    item({}),
    item({ id: "reply-t2", title: "Reply to Rania Khoury", priority: "medium", start: today(14), end: today(14, 30), threadId: "t2", contact: "Rania Khoury", overdue: true, dueAt: today(10), why: "Overdue: was due today 10:00. Moved to the next free slot." }),
    item({ id: "meeting-t3", kind: "meeting", priority: undefined, title: "Site visit in Jounieh", start: today(15), end: today(16), threadId: "t3", why: "A meeting mentioned in the email from Haddad Plumbing." }),
  ],
  ...extra,
});
function show(data: Schedule = schedule()) {
  vi.spyOn(api, "schedule").mockResolvedValue(data);
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SchedulePage /><ConfirmHost /><Toaster /></QueryClientProvider>);
}

test("shows what's on today and how much is overdue, then the calendar", async () => {
  show();
  expect(await screen.findByRole("heading", { name: "Schedule" })).toBeTruthy();
  const stats = screen.getByRole("list", { name: "Schedule summary" });
  // By label, not by number: other counts can be 3 too, depending on the time of day the test runs.
  expect(within(stats).getByText("Today").closest("li")!.textContent).toMatch(/^3/);
  expect(within(stats).getByText("Overdue").closest("li")!.textContent).toMatch(/^1/);
  expect(await screen.findByText("Reply to Kevin Elmurr")).toBeTruthy();
  expect(screen.getByText("Site visit in Jounieh")).toBeTruthy();
  expect(api.schedule).toHaveBeenCalledWith(Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test("an item explains why it's scheduled and opens its email or a reply", async () => {
  show();
  fireEvent.click(await screen.findByText("Reply to Kevin Elmurr"));
  const panel = screen.getByRole("region", { name: "Reply to Kevin Elmurr" });
  expect(within(panel).getByText(/2 hours after Kevin Elmurr's email arrived/)).toBeTruthy();
  expect(within(panel).getByText(/a quote on 4 inverter batteries/)).toBeTruthy();
  fireEvent.click(within(panel).getByRole("button", { name: /Read the email/ }));
  expect(useViewer.getState().threadId).toBe("t1");
  fireEvent.click(within(panel).getByRole("button", { name: /Write a reply/ }));
  expect(useReply.getState().threadId).toBe("t1");
  expect(within(panel).getByRole("link", { name: /Open in Gmail/ }).getAttribute("href")).toBe("https://mail.google.com/mail/u/0/#all/t1");
});

test("without calendar access, the button asks Google for it (the app's own calendar only)", async () => {
  show(schedule({ calendar: { canSync: false, name: "AI Workspace OS", lastSyncAt: null, syncedCount: 0 } }));
  const link = await screen.findByRole("link", { name: /Allow calendar access/ });
  expect(link.getAttribute("href")).toBe("/api/auth/google/start?calendar=1");
  expect(screen.queryByRole("button", { name: /Sync to Google Calendar/ })).toBeNull();
});

test("syncing asks first, says exactly what it will do, and only then writes", async () => {
  const sync = vi.spyOn(api, "syncSchedule").mockResolvedValue({ created: 3, updated: 0, unchanged: 0, removed: 0, failed: 0, total: 3, calendarName: "AI Workspace OS", calendarId: "c1" });
  show();
  fireEvent.click(await screen.findByRole("button", { name: /Sync to Google Calendar/ }));
  const dialog = screen.getByRole("alertdialog", { name: /Sync to Google Calendar/ });
  expect(dialog.textContent).toMatch(/3 events/);
  expect(dialog.textContent).toMatch(/separate calendar called "AI Workspace OS"/);
  expect(dialog.textContent).toMatch(/other calendars aren't touched/i);
  expect(sync).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Sync now" }));
  await waitFor(() => expect(sync).toHaveBeenCalledWith(Intl.DateTimeFormat().resolvedOptions().timeZone));
  expect((await screen.findAllByText(/3 added/)).length).toBeGreaterThan(0); // the result line and the toast
});

test("a failed sync keeps the confirmation open with the reason, so it can be retried", async () => {
  vi.spyOn(api, "syncSchedule").mockRejectedValue(new Error("Google Calendar refused access."));
  show();
  fireEvent.click(await screen.findByRole("button", { name: /Sync to Google Calendar/ }));
  const dialog = await screen.findByRole("alertdialog", { name: /Sync to Google Calendar/ });
  fireEvent.click(within(dialog).getByRole("button", { name: "Sync now" }));
  expect(await within(dialog).findByText(/Google Calendar refused access/)).toBeTruthy();
});

test("with nothing on the schedule, there's nothing to sync", async () => {
  show(schedule({ items: [] }));
  const btn = await screen.findByRole("button", { name: /Sync to Google Calendar/ });
  expect((btn as HTMLButtonElement).disabled).toBe(true);
});

test("nothing connected: one clear next step", async () => {
  show({ connected: false, items: [], timeZone: "Asia/Beirut" } as unknown as Schedule);
  expect(await screen.findByRole("link", { name: /Connect Gmail/ })).toBeTruthy();
});

// ---- availability and meeting requests (decision #55) ----
const nine: [string, string][] = [["09:00", "17:00"]];
const avail: Availability = { weekly: { Mon: nine, Tue: nine, Wed: nine, Thu: nine, Fri: nine, Sat: [], Sun: [] }, dates: {} };
const req = (extra: Partial<MeetingRequest> = {}): MeetingRequest => ({
  id: "mr-t9-1", threadId: "t9", title: "Pilot review", contact: "Rania Khoury", source: "email-text", start: today(19), end: today(20), receivedAt: today(8),
  status: "pending", reason: "outside", clashWith: null, decidedAt: today(9), decidedBy: "rules", email: null, ...extra,
});
const meetings = (extra: Partial<NonNullable<Schedule["meetings"]>> = {}): Schedule["meetings"] => ({
  availability: avail, defaultAvailability: avail, timeZone: "Asia/Beirut", activatedAt: today(0), dryRun: false, requests: [], ...extra,
});

test("the calendar covers the whole day, midnight to midnight", async () => {
  show(schedule({ meetings: meetings() }));
  fireEvent.click(await screen.findByRole("button", { name: "Day" }));
  expect(screen.getAllByText("00:00").length).toBeGreaterThan(0);
  expect(screen.getAllByText("23:00").length).toBeGreaterThan(0);
});

test("before availability is set there's one clear next step; saving sends weekly hours and date changes", async () => {
  const save = vi.spyOn(api, "saveAvailability").mockResolvedValue({ ok: true });
  show(schedule({ meetings: meetings({ availability: null }) }));
  expect(await screen.findByText("Set your availability")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: /Set availability/ })[0]);
  const dialog = screen.getByRole("dialog", { name: "Your availability" });
  fireEvent.click(within(dialog).getByRole("switch", { name: "Saturday" }));
  fireEvent.change(within(dialog).getByLabelText("Monday, slot 1, until"), { target: { value: "13:00" } });
  fireEvent.click(within(dialog).getByRole("button", { name: /Add a date/ }));
  fireEvent.change(within(dialog).getByLabelText("Date 1"), { target: { value: "2026-11-20" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save availability" }));
  // The first save switches on automatic replies (real email), so it asks first.
  const ask = await screen.findByRole("alertdialog", { name: "Turn on automatic meeting replies?" });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: "Save and turn on" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({
    weekly: { ...avail.weekly, Mon: [["09:00", "13:00"]], Sat: [["09:00", "17:00"]] },
    dates: { "2026-11-20": [] },
  }, Intl.DateTimeFormat().resolvedOptions().timeZone));
});

test("a slot that ends before it starts is caught before saving", async () => {
  const save = vi.spyOn(api, "saveAvailability").mockResolvedValue({ ok: true });
  show(schedule({ meetings: meetings() }));
  fireEvent.click(await screen.findByRole("button", { name: /Availability/ }));
  const dialog = screen.getByRole("dialog", { name: "Your availability" });
  fireEvent.change(within(dialog).getByLabelText("Tuesday, slot 1, until"), { target: { value: "08:00" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save availability" }));
  expect(await within(dialog).findByRole("alert")).toBeTruthy();
  expect(within(dialog).getByRole("alert").textContent).toMatch(/Tuesday.*end after it starts/);
  expect(save).not.toHaveBeenCalled();
});

test("a request outside your hours waits for you: Accept asks first, then emails 'I'm available'", async () => {
  const answer = vi.spyOn(api, "answerMeetingRequest").mockResolvedValue(req({ status: "confirmed" }));
  show(schedule({ meetings: meetings({ requests: [req()] }) }));
  const card = await screen.findByRole("region", { name: "Request from Rania Khoury: Pilot review" });
  expect(card.textContent).toMatch(/outside your available hours/i);
  fireEvent.click(within(card).getByRole("button", { name: "Accept" }));
  const ask = await screen.findByRole("alertdialog", { name: /Accept "Pilot review"/ });
  expect(ask.textContent).toMatch(/email Rania Khoury/);
  expect(ask.textContent).toMatch(/works for you/);
  expect(answer).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: "Send and accept" }));
  await waitFor(() => expect(answer).toHaveBeenCalledWith("mr-t9-1", true));
});

test("declining sends 'not available' with your free times", async () => {
  const answer = vi.spyOn(api, "answerMeetingRequest").mockResolvedValue(req({ status: "declined" }));
  show(schedule({ meetings: meetings({ requests: [req()] }) }));
  const card = await screen.findByRole("region", { name: "Request from Rania Khoury: Pilot review" });
  fireEvent.click(within(card).getByRole("button", { name: "Decline" }));
  const ask = await screen.findByRole("alertdialog", { name: /Decline "Pilot review"/ });
  expect(ask.textContent).toMatch(/not available/);
  expect(ask.textContent).toMatch(/free times/);
  fireEvent.click(within(ask).getByRole("button", { name: "Send and decline" }));
  await waitFor(() => expect(answer).toHaveBeenCalledWith("mr-t9-1", false));
});

test("automatic replies are listed with the reason and the email; a failed one can be retried", async () => {
  const retry = vi.spyOn(api, "retryMeetingEmail").mockResolvedValue(req());
  show(schedule({ meetings: meetings({ requests: [
    req({ id: "mr-a-1", status: "auto-declined", reason: "past", email: { kind: "past", body: "Hi Rania, the time you suggested has already passed.", sentAt: today(9), error: null, dryRun: false } }),
    req({ id: "mr-b-2", title: "Site visit", status: "auto-declined", reason: "clash", clashWith: "Pilot review", email: { kind: "clash", body: "Hi Rania, I already have another meeting.", sentAt: null, error: "Gmail couldn't send the reply (500).", dryRun: false } }),
  ] }) }));
  const list = await screen.findByRole("region", { name: "Automatic replies" });
  expect(list.textContent).toMatch(/time had already passed/);
  expect(list.textContent).toMatch(/Clashed with Pilot review/);
  expect(list.textContent).toContain("Couldn't send: Gmail couldn't send the reply (500).");
  expect(within(list).getAllByText(/the time you suggested has already passed/).length).toBe(1);
  fireEvent.click(within(list).getByRole("button", { name: "Retry" }));
  const ask = await screen.findByRole("alertdialog", { name: "Try sending this email again?" });
  expect(retry).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: "Send again" }));
  await waitFor(() => expect(retry).toHaveBeenCalledWith("mr-b-2"));
});

test("test mode says replies are recorded, not sent", async () => {
  show(schedule({ meetings: meetings({ dryRun: true }) }));
  expect(await screen.findByText(/Test mode/)).toBeTruthy();
});

test("a meeting that ends at midnight stays in the time grid, not the all-day row", async () => {
  const late = new Date(); late.setHours(23, 0, 0, 0);
  const midnight = new Date(late); midnight.setDate(midnight.getDate() + 1); midnight.setHours(0, 0, 0, 0);
  show(schedule({ meetings: meetings(), items: [item({ id: "meeting-late", kind: "meeting", priority: undefined, title: "Late call", start: late.toISOString(), end: midnight.toISOString() })] }));
  fireEvent.click(await screen.findByRole("button", { name: "Day" }));
  const chip = await screen.findByText("Late call");
  expect(chip.closest(".rbc-allday-cell")).toBeNull();
  expect(chip.closest(".rbc-time-content")).not.toBeNull();
});

test("an answer written in test mode can be sent once test mode is off", async () => {
  const send = vi.spyOn(api, "retryMeetingEmail").mockResolvedValue(req({ status: "declined", decidedBy: "user" }));
  const declined = req({ id: "mr-k-1", status: "declined", decidedBy: "user", email: { kind: "declined", body: "Hi Kevin, unfortunately I'm not available.", sentAt: null, error: null, dryRun: true } });
  show(schedule({ meetings: meetings({ dryRun: false, requests: [declined] }) }));
  const list = await screen.findByRole("region", { name: "Your answers" });
  expect(list.textContent).toMatch(/Written in test mode, not sent yet/);
  fireEvent.click(within(list).getByRole("button", { name: "Send now" }));
  fireEvent.click(within(await screen.findByRole("alertdialog", { name: "Send this email now?" })).getByRole("button", { name: "Send now" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith("mr-k-1"));
});

test("while test mode is on there's no Send now button", async () => {
  const declined = req({ id: "mr-k-1", status: "declined", decidedBy: "user", email: { kind: "declined", body: "Hi Kevin", sentAt: null, error: null, dryRun: true } });
  show(schedule({ meetings: meetings({ dryRun: true, requests: [declined] }) }));
  const list = await screen.findByRole("region", { name: "Your answers" });
  expect(within(list).queryByRole("button", { name: "Send now" })).toBeNull();
});

test("items at the same time sit side by side instead of on top of each other", async () => {
  show(schedule({ meetings: meetings(), items: [
    item({ id: "meeting-a", kind: "meeting", priority: undefined, title: "Request A", start: today(10), end: today(11) }),
    item({ id: "deadline-b", kind: "deadline", priority: undefined, title: "Due B", start: today(10), end: today(10, 30) }),
  ] }));
  fireEvent.click(await screen.findByRole("button", { name: "Day" }));
  const box = (title: string) => (screen.getByText(title).closest(".rbc-event") as HTMLElement).style;
  await screen.findByText("Request A");
  const [a, b] = [box("Request A"), box("Due B")];
  const pct = (v: string) => parseFloat(/([\d.]+)%/.exec(v)?.[1] ?? "NaN"); // "calc(50% - 3px)" → 50
  expect(pct(a.width)).toBeLessThanOrEqual(50);
  expect(pct(b.width)).toBeLessThanOrEqual(50);
  expect(pct(a.left) + pct(a.width)).toBeLessThanOrEqual(pct(b.left)); // b starts where a ends
});
