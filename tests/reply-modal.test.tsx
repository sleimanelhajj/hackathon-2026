// The reply dialog: AI drafts, the user edits, and nothing is sent without two explicit clicks (AGENTS.md rule 4).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, type ReplyDraft, type Status } from '../src/lib/api';
import { ReplyModal, useReply } from '../src/components/ReplyModal';

const draft: ReplyDraft = {
  threadId: 't1',
  to: [{ name: 'Lena Ortiz', email: 'lena@ortiz.example' }],
  subject: 'Re: Pricing',
  body: 'Hi Lena,\nThe price is [confirm price].\n\nBest regards,',
  note: 'Confirm the price.',
  model: 'test-model',
  filesRead: ['Proposal.pdf'],
  replyingTo: { from: 'Lena Ortiz', date: '2026-11-14T10:00:00Z', snippet: 'Can you send the revised pricing?' },
};

const status = (gmail: Partial<NonNullable<Status['gmail']>>): Status => ({
  database: true,
  googleConfigured: true,
  gemini: { configured: true, model: 'test-model' },
  companyData: { configured: false, name: 'Company database' },
  gmail: { mode: 'live', email: 'you@northwind.example', status: 'connected', scopes: [], lastSyncAt: null, lastSyncCount: null, error: null, connectedAt: null, syncProgress: null, mailbox: null, analysis: null, canSend: true, ...gmail },
});

let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // jsdom has no <dialog> methods.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.spyOn(api, 'draftReply').mockResolvedValue(structuredClone(draft));
  send = vi.spyOn(api, 'sendReply').mockResolvedValue({ ok: true, id: 'sent-1' });
});
afterEach(() => {
  act(() => useReply.getState().close());
  cleanup();
});

function open(s: Status) {
  vi.spyOn(api, 'status').mockResolvedValue(s);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ReplyModal /></QueryClientProvider>);
  act(() => useReply.getState().open('t1', 'Lena Ortiz'));
}

test('shows the AI draft as editable fields, with the files it read and what to check', async () => {
  open(status({}));
  const body = await screen.findByDisplayValue(/The price is \[confirm price\]/);
  expect(screen.getByDisplayValue('lena@ortiz.example')).toBeTruthy();
  expect(screen.getByDisplayValue('Re: Pricing')).toBeTruthy();
  expect(screen.getByText(/Draft based on: Proposal\.pdf/)).toBeTruthy();
  expect(screen.getByText(/Confirm the price\./)).toBeTruthy();
  fireEvent.change(body, { target: { value: 'Hi Lena, the price is 120 USD.' } });
  expect(screen.getByDisplayValue('Hi Lena, the price is 120 USD.')).toBeTruthy();
});

test('the title, close button and Send stay in view; only the fields between them scroll', async () => {
  open(status({}));
  await screen.findByDisplayValue(/The price is/);
  const dialog = document.querySelector('dialog.modal')!;
  expect(dialog.classList.contains('modal-reply')).toBe(true);
  const scroll = dialog.querySelector('.modal-scroll')!;
  expect(scroll).toBeTruthy();
  expect(scroll.contains(screen.getByDisplayValue('lena@ortiz.example'))).toBe(true);
  expect(scroll.contains(screen.getByText(/Confirm the price\./))).toBe(true);
  expect(scroll.contains(screen.getByRole('heading', { name: /Reply to Lena Ortiz/ }))).toBe(false);
  expect(scroll.contains(screen.getByRole('button', { name: 'Close' }))).toBe(false);
  expect(scroll.contains(screen.getByRole('button', { name: /Send reply/ }))).toBe(false);
});

test('the "check before sending" note is a warning in amber and the AI tag uses the brand blue', async () => {
  open(status({}));
  await screen.findByDisplayValue(/The price is/);
  expect(screen.getByText(/Confirm the price\./).closest('.reply-note')).toBeTruthy();
  expect(document.querySelector('.field-label-row .tag')!.getAttribute('data-tone')).toBe('accent');
});

test('sends only after Send reply AND the confirm button, with the edited text', async () => {
  open(status({}));
  const body = await screen.findByDisplayValue(/The price is/);
  fireEvent.change(body, { target: { value: 'Edited reply' } });
  fireEvent.click(screen.getByRole('button', { name: /Send reply/ }));
  expect(send).not.toHaveBeenCalled(); // first click only asks to confirm
  fireEvent.click(screen.getByRole('button', { name: /Send to lena@ortiz\.example/ }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send.mock.calls[0][0]).toEqual({ threadId: 't1', to: [{ name: '', email: 'lena@ortiz.example' }], subject: 'Re: Pricing', body: 'Edited reply' });
  expect(await screen.findByText('Reply sent')).toBeTruthy();
});

test('Back cancels the confirm step without sending', async () => {
  open(status({}));
  await screen.findByDisplayValue(/The price is/);
  fireEvent.click(screen.getByRole('button', { name: /Send reply/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Send reply/ })).toBeTruthy();
});

test('cannot send sample data', async () => {
  open(status({ mode: 'sample' }));
  await screen.findByDisplayValue(/The price is/);
  expect(screen.getByText(/sample data, so replies can't be sent/)).toBeTruthy();
  expect((screen.getByRole('button', { name: /Send reply/ }) as HTMLButtonElement).disabled).toBe(true);
});

test('cannot send until Gmail has granted the send permission', async () => {
  open(status({ canSend: false }));
  await screen.findByDisplayValue(/The price is/);
  expect(screen.getByText(/Gmail hasn't allowed sending yet/)).toBeTruthy();
  expect((screen.getByRole('button', { name: /Send reply/ }) as HTMLButtonElement).disabled).toBe(true);
});

test('blocks sending to something that is not an email address', async () => {
  open(status({}));
  await screen.findByDisplayValue(/The price is/);
  fireEvent.change(screen.getByDisplayValue('lena@ortiz.example'), { target: { value: 'lena at ortiz' } });
  expect((screen.getByRole('button', { name: /Send reply/ }) as HTMLButtonElement).disabled).toBe(true);
});

test('if the AI draft fails, the user can still write the reply', async () => {
  vi.spyOn(api, 'draftReply').mockRejectedValue(new Error('Gemini is overloaded right now.'));
  open(status({}));
  expect(await screen.findByText(/Couldn't write a draft: Gemini is overloaded/)).toBeTruthy();
  expect(screen.getByPlaceholderText('Write your reply')).toBeTruthy();
});

test('a draft that used live stock says which figures it used (decision #57)', async () => {
  vi.spyOn(api, 'draftReply').mockResolvedValue({ ...structuredClone(draft), inventory: [
    { sku: 'CH-0001', name: 'Solar panel 450W', inStock: 9, unit: 'panel', listPriceUSD: 189, status: 'low' },
    { sku: 'CH-0002', name: 'Inverter battery 200Ah', inStock: 0, unit: 'battery', listPriceUSD: 1450, status: 'out of stock' },
  ] });
  open(status({}));
  const note = await screen.findByRole('note', { name: 'Stock used in this draft' });
  expect(note.textContent).toMatch(/Solar panel 450W: 9 in stock/);
  expect(note.textContent).toMatch(/Inverter battery 200Ah: out of stock/);
});
