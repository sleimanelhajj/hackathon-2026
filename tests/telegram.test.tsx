// Telegram on the Integrations page and the Telegram tab (decisions #64, #65): the user signs in step by step (phone,
// code, two-step password), disconnect asks first, the tab lists the chats of the people they follow, shows an AI
// summary per chat, and sends a message only after the user confirms its exact text.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type TelegramInsight, type TelegramStatus } from "../src/lib/api";
import { TelegramCard } from "../src/telegram/TelegramCard";
import TelegramPage from "../src/pages/TelegramPage";
import { ConfirmHost, dismissConfirm } from "../src/components/ConfirmDialog";

afterEach(() => { dismissConfirm(); cleanup(); vi.restoreAllMocks(); });
const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}<ConfirmHost /></QueryClientProvider>);

const base: TelegramStatus = { configured: true, connected: false, account: null, status: null, error: null, lastSyncAt: null, lastSyncCount: null, chatCount: 0, pending: null, people: [], insightsAvailable: true };
const connected: TelegramStatus = { ...base, connected: true, status: "connected", account: { id: "1", name: "Rami Haddad", username: "rami", phone: "•••• 3456" }, lastSyncAt: new Date().toISOString(), lastSyncCount: 3, chatCount: 2 };

test("not set up on the server: says which settings are missing, no sign-in form", async () => {
  vi.spyOn(api, "telegramStatus").mockResolvedValue({ ...base, configured: false });
  wrap(<TelegramCard />);
  expect(await screen.findByText(/TELEGRAM_API_ID/)).toBeTruthy();
  expect(screen.queryByLabelText(/Phone number/)).toBeNull();
});

test("phone, then code, then the two-step password connects", async () => {
  const status = vi.spyOn(api, "telegramStatus").mockResolvedValueOnce(base);
  const send = vi.spyOn(api, "telegramSendCode").mockResolvedValue({ sent: true, viaApp: true });
  const verify = vi.spyOn(api, "telegramVerifyCode").mockResolvedValue({ needsPassword: true });
  const password = vi.spyOn(api, "telegramVerifyPassword").mockResolvedValue({ connected: true });
  wrap(<TelegramCard />);
  fireEvent.change(await screen.findByLabelText(/Phone number/), { target: { value: "+961 70 123 456" } });
  status.mockResolvedValueOnce({ ...base, pending: "code" });
  fireEvent.click(screen.getByRole("button", { name: /Send me a code/ }));
  await waitFor(() => expect(send).toHaveBeenCalledWith("+961 70 123 456"));
  fireEvent.change(await screen.findByLabelText(/Code from Telegram/), { target: { value: "12 345" } });
  status.mockResolvedValueOnce({ ...base, pending: "password" });
  fireEvent.click(screen.getByRole("button", { name: /Connect Telegram/ }));
  await waitFor(() => expect(verify).toHaveBeenCalledWith("12345"));
  const pw = await screen.findByLabelText(/Two-step verification password/);
  expect(pw.getAttribute("type")).toBe("password");
  fireEvent.change(pw, { target: { value: "open sesame" } });
  status.mockResolvedValue(connected);
  fireEvent.click(screen.getByRole("button", { name: /Connect Telegram/ }));
  await waitFor(() => expect(password).toHaveBeenCalledWith("open sesame"));
  expect(await screen.findByText(/Rami Haddad/)).toBeTruthy();
});

test("a wrong code shows Telegram's reason under the form", async () => {
  vi.spyOn(api, "telegramStatus").mockResolvedValue({ ...base, pending: "code" });
  vi.spyOn(api, "telegramVerifyCode").mockRejectedValue(new Error("That code isn't right. Check the latest code in your Telegram app and try again."));
  wrap(<TelegramCard />);
  fireEvent.change(await screen.findByLabelText(/Code from Telegram/), { target: { value: "00000" } });
  fireEvent.click(screen.getByRole("button", { name: /Connect Telegram/ }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/code isn't right/);
});

test("disconnect asks first, then signs out", async () => {
  vi.spyOn(api, "telegramStatus").mockResolvedValue(connected);
  const off = vi.spyOn(api, "telegramDisconnect").mockResolvedValue({ disconnected: true });
  wrap(<TelegramCard />);
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
  expect(off).not.toHaveBeenCalled();
  const dialog = await screen.findByRole("alertdialog", { name: "Disconnect Telegram?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect and delete chats" }));
  await waitFor(() => expect(off).toHaveBeenCalledTimes(1));
});

test("the Telegram tab lists chats and opens a conversation as plain text", async () => {
  vi.spyOn(api, "telegramStatus").mockResolvedValue(connected);
  vi.spyOn(api, "telegramChats").mockResolvedValue({ chats: [
    { id: "100", title: "Frem Electric", kind: "user", unread: 2, lastMessageAt: new Date().toISOString(), messageCount: 2 },
    { id: "200", title: "Store team", kind: "group", unread: 0, lastMessageAt: new Date().toISOString(), messageCount: 1 },
  ] });
  vi.spyOn(api, "telegramMessages").mockResolvedValue({ messages: [
    { id: 1, chatId: "100", date: new Date().toISOString(), out: false, from: "Karim", hasMedia: false, text: "<b>Can you send the invoice?</b>" },
    { id: 2, chatId: "100", date: new Date().toISOString(), out: true, from: null, hasMedia: true, text: "Sure" },
  ] });
  wrap(<TelegramPage />);
  const list = await screen.findByRole("navigation", { name: "Telegram chats" });
  expect(within(list).getByLabelText("2 unread")).toBeTruthy();
  fireEvent.click(within(list).getByRole("button", { name: /Frem Electric/ }));
  expect(await screen.findByText("<b>Can you send the invoice?</b>")).toBeTruthy();
  expect(screen.getByText(/open Telegram to see it/)).toBeTruthy();
  expect(screen.getByLabelText("Message to Frem Electric")).toBeTruthy();
});

const chat = { id: "100", title: "Karim Haddad", kind: "user" as const, unread: 1, lastMessageAt: new Date().toISOString(), messageCount: 2 };
const thread = [
  { id: 1, chatId: "100", date: new Date().toISOString(), out: false, from: "Karim", hasMedia: false, text: "Can you send the invoice by Friday?" },
  { id: 2, chatId: "100", date: new Date().toISOString(), out: true, from: null, hasMedia: false, text: "Yes, tomorrow" },
];
const insight: TelegramInsight = {
  summary: "Karim asked for the invoice; you said you'd send it tomorrow.", topics: ["Invoice"], waitingOn: "you",
  nextStep: "Send Karim the invoice.", promises: [{ by: "you", what: "Send the invoice", due: "tomorrow", messageId: 2 }],
  followUps: [{ what: "Check he received it", messageId: 1 }], suggestedMessage: "Hi Karim, here is the invoice.",
  basedOn: 2, generatedAt: new Date().toISOString(), model: "m",
};
const openKarim = async () => {
  vi.spyOn(api, "telegramStatus").mockResolvedValue({ ...connected, people: ["Karim"] });
  vi.spyOn(api, "telegramChats").mockResolvedValue({ chats: [chat] });
  vi.spyOn(api, "telegramMessages").mockResolvedValue({ messages: thread });
  vi.spyOn(api, "telegramInsight").mockResolvedValue(insight);
  wrap(<TelegramPage />);
  fireEvent.click(within(await screen.findByRole("navigation", { name: "Telegram chats" })).getByRole("button", { name: /Karim Haddad/ }));
};

test("choose people: add a name, save, and the list is sent to the server", async () => {
  vi.spyOn(api, "telegramStatus").mockResolvedValue(connected);
  vi.spyOn(api, "telegramChats").mockResolvedValue({ chats: [chat] });
  const save = vi.spyOn(api, "telegramSetPeople").mockResolvedValue({ people: ["Maya", "Karim Haddad"] });
  wrap(<TelegramPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Choose people" }));
  const dialog = await screen.findByRole("dialog", { name: "Choose who to follow" });
  fireEvent.change(within(dialog).getByLabelText(/Name as it shows in Telegram/), { target: { value: "Maya" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  fireEvent.click(within(dialog).getByRole("button", { name: /Karim Haddad/ })); // suggestion from recent chats
  expect(within(dialog).getByRole("list", { name: "People you follow" }).textContent).toMatch(/Maya.*Karim Haddad/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Save and read chats" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(["Maya", "Karim Haddad"]));
});

test("a chat shows the AI summary as a guess, with promises linked to their message, and the suggested message fills the box", async () => {
  await openKarim();
  const summary = await screen.findByRole("region", { name: "AI summary of this chat" });
  expect(await within(summary).findByText(/you said you'd send it tomorrow/)).toBeTruthy();
  expect(within(summary).getByText("AI guess")).toBeTruthy();
  expect(within(summary).getByText("Waiting on you")).toBeTruthy();
  expect(within(summary).getAllByRole("button", { name: /See message/ })).toHaveLength(2);
  fireEvent.click(within(summary).getByRole("button", { name: "Use this message" }));
  expect((screen.getByLabelText("Message to Karim Haddad") as HTMLTextAreaElement).value).toBe("Hi Karim, here is the invoice.");
});

test("sending asks first with the exact text; nothing is sent until the user confirms", async () => {
  const send = vi.spyOn(api, "telegramSend").mockResolvedValue({ message: { ...thread[1], id: 3, text: "On its way" } });
  await openKarim();
  fireEvent.change(await screen.findByLabelText("Message to Karim Haddad"), { target: { value: "On its way" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  let dialog = await screen.findByRole("alertdialog", { name: "Send to Karim Haddad?" });
  expect(within(dialog).getByText("On its way")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  dialog = await screen.findByRole("alertdialog", { name: "Send to Karim Haddad?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith("100", "On its way"));
  await waitFor(() => expect((screen.getByLabelText("Message to Karim Haddad") as HTMLTextAreaElement).value).toBe(""));
});

test("when Gemini is busy the summary says so and can be tried again", async () => {
  vi.spyOn(api, "telegramStatus").mockResolvedValue({ ...connected, people: ["Karim"] });
  vi.spyOn(api, "telegramChats").mockResolvedValue({ chats: [chat] });
  vi.spyOn(api, "telegramMessages").mockResolvedValue({ messages: thread });
  vi.spyOn(api, "telegramInsight").mockRejectedValue(new Error("Gemini is overloaded right now. Try again in a few minutes."));
  const again = vi.spyOn(api, "telegramRefreshInsight").mockResolvedValue(insight);
  wrap(<TelegramPage />);
  fireEvent.click(within(await screen.findByRole("navigation", { name: "Telegram chats" })).getByRole("button", { name: /Karim Haddad/ }));
  const summary = await screen.findByRole("region", { name: "AI summary of this chat" });
  expect((await within(summary).findByRole("alert")).textContent).toMatch(/overloaded/);
  fireEvent.click(within(summary).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(again).toHaveBeenCalledWith("100"));
  expect(await within(summary).findByText(/you said you'd send it tomorrow/)).toBeTruthy();
});
