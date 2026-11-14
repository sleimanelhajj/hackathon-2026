// The Schedule page (src/pages/SchedulePage.tsx): a calendar built from Gmail. Each item says why it's there and
// opens its email; syncing to Google Calendar needs calendar access and a confirmation.
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Schedule, type ScheduleItem } from "../src/lib/api";
import SchedulePage from "../src/pages/SchedulePage";
import { useViewer } from "../src/components/EmailViewer";
import { useReply } from "../src/components/ReplyModal";

beforeAll(() => {
  // jsdom has no layout; react-big-calendar measures with these.
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 900 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); act(() => { useViewer.getState().close(); useReply.getState().close(); }); });

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
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SchedulePage /></QueryClientProvider>);
}

test("shows what's on today and how much is overdue, then the calendar", async () => {
  show();
  expect(await screen.findByRole("heading", { name: "Schedule" })).toBeTruthy();
  const stats = screen.getByRole("list", { name: "Schedule summary" });
  expect(within(stats).getByText("3").closest("li")!.textContent).toMatch(/Today/);
  expect(within(stats).getByText("1").closest("li")!.textContent).toMatch(/Overdue/);
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
  expect(await screen.findByText(/3 added/)).toBeTruthy();
});

test("sample data can't be synced, and says so", async () => {
  show(schedule({ sample: true }));
  const btn = await screen.findByRole("button", { name: /Sync to Google Calendar/ });
  expect((btn as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("This is sample data")).toBeTruthy();
});

test("nothing connected: one clear next step", async () => {
  show({ connected: false, items: [], timeZone: "Asia/Beirut" } as unknown as Schedule);
  expect(await screen.findByRole("link", { name: /Connect Gmail/ })).toBeTruthy();
});
