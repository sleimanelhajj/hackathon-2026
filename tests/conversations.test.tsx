// Dashboard conversation widgets: clean rows, "Needs your attention" grouped into topic folders, clear contacts,
// and a viewer that shows the whole email.
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, type Contact, type InsightRow, type ThreadView } from '../src/lib/api';
import { DashboardDataProvider, type DashboardData } from '../src/dashboard/DataContext';
import { InsightListWidget } from '../src/widgets/InsightWidgets';
import { ContactsWidget } from '../src/widgets/ContactsWidget';
import { EmailViewer, useViewer } from '../src/components/EmailViewer';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => {
  act(() => useViewer.getState().close());
  cleanup();
});

const row = (id: string, extra: Partial<InsightRow> = {}): InsightRow => ({
  threadId: id, subject: `Subject ${id}`, contact: 'Kevin Elmurr', lastAt: new Date().toISOString(), waitingDays: 0,
  link: null, category: 'billing', priority: 'high', needsReply: true, summary: `Summary ${id}`,
  reason: `Reason ${id}`, suggestedAction: `Do ${id}`, certainty: 'inferred', stale: false, ...extra,
});

const contact = (extra: Partial<Contact> = {}): Contact => ({
  email: 'elmurrkevin@gmail.com', name: 'Kevin Elmurr', domain: 'gmail.com', received: 64, sent: 0,
  lastAt: new Date().toISOString(), firstAt: new Date().toISOString(), isNew: true, isInternal: false, aiLead: true,
  needsReply: 12, threadCount: 64,
  threads: [{ threadId: 'k1', subject: 'Bank details changed', lastAt: new Date().toISOString(), link: null, category: 'billing', priority: 'high', needsReply: true }],
  ...extra,
});

function withData(node: ReactNode, rows: InsightRow[], contacts: Contact[] = []) {
  const data = {
    insights: { configured: true, status: 'done', error: null, progress: null, lastRunAt: null, model: 'm', analysedThreads: rows.length, totalThreads: rows.length, categories: [], rows },
    contacts,
  } as unknown as DashboardData;
  return render(<QueryClientProvider client={new QueryClient()}><DashboardDataProvider value={data}>{node}</DashboardDataProvider></QueryClientProvider>);
}

// ---- Needs your attention ----
const attention = { id: 'ai', type: 'insight-list', title: 'Needs your attention', focus: 'high-priority' } as const;

test('groups urgent conversations into topic folders with counts, biggest first', () => {
  withData(<InsightListWidget widget={attention} />, [
    row('1', { category: 'billing' }), row('2', { category: 'billing' }), row('3', { category: 'support' }), row('4', { priority: 'low' }),
  ]);
  const folders = screen.getAllByRole('button', { name: /conversations/ });
  expect(folders.map((f) => f.textContent)).toEqual([
    expect.stringMatching(/Billing and invoices.*2/), expect.stringMatching(/Problems and complaints.*1/),
  ]);
});

test('folders start closed, showing just the topics and counts', () => {
  withData(<InsightListWidget widget={attention} />, [row('1'), row('2', { category: 'support' })]);
  for (const folder of screen.getAllByRole('button', { name: /conversations/ })) expect(folder.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Summary 1')).toBeNull();
});

const openFolder = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

test('a row shows who, what and when once, without AI-guess, priority or reason clutter', () => {
  withData(<InsightListWidget widget={attention} />, [row('1')]);
  openFolder(/Billing and invoices/);
  const item = screen.getByRole('listitem');
  expect(within(item).getByText('Kevin Elmurr')).toBeTruthy();
  expect(within(item).getByText('Summary 1')).toBeTruthy();
  expect(within(item).queryByText(/AI guess/)).toBeNull();
  expect(within(item).queryByText(/High priority/)).toBeNull(); // the whole list is high priority
  expect(within(item).queryByText(/Why:/)).toBeNull();
  expect(within(item).queryByText('Subject 1')).toBeNull(); // the summary already says what it's about
  expect(screen.queryByText(/AI guess/)).toBeNull();
});

test('folders open and close', () => {
  withData(<InsightListWidget widget={attention} />, [row('1'), row('2', { category: 'support' })]);
  const billing = screen.getByRole('button', { name: /Billing and invoices/ });
  fireEvent.click(billing);
  expect(billing.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Summary 1')).toBeTruthy();
  expect(screen.queryByText('Summary 2')).toBeNull(); // other folders stay closed
  fireEvent.click(billing);
  expect(billing.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Summary 1')).toBeNull();
});

test('clicking a conversation opens the full email', () => {
  withData(<InsightListWidget widget={attention} />, [row('1')]);
  openFolder(/Billing and invoices/);
  fireEvent.click(screen.getByRole('button', { name: /Open conversation with Kevin Elmurr/ }));
  expect(useViewer.getState().threadId).toBe('1');
});

test('topic lists (e.g. Billing) show clean rows without folders, and still mark what needs a reply', () => {
  withData(<InsightListWidget widget={{ id: 'b', type: 'insight-list', title: 'Billing', focus: 'billing' }} />, [
    row('1', { needsReply: true }), row('2', { needsReply: false, priority: 'medium' }),
  ]);
  expect(screen.queryAllByRole('button', { name: /conversations/ })).toHaveLength(0);
  expect(screen.getAllByText('Needs reply')).toHaveLength(1);
  expect(screen.getAllByText('Urgent')).toHaveLength(1);
});

// ---- Contacts ----
const contactsWidget = { id: 'c', type: 'contacts', title: 'Contacts', show: 'all' } as const;

test('a contact says in words what the numbers mean', () => {
  withData(<ContactsWidget widget={contactsWidget} />, [], [contact()]);
  const head = screen.getByRole('button', { name: /Kevin Elmurr/ });
  expect(head.textContent).toMatch(/64 emails/);
  expect(head.textContent).toMatch(/12 to reply/);
  expect(head.textContent).toMatch(/New contact/);
  expect(head.textContent).not.toMatch(/\bLead\b/); // an AI guess, kept off the main row
});

test("opening a contact lists their conversations, and clicking one opens the full email", () => {
  withData(<ContactsWidget widget={contactsWidget} />, [], [contact()]);
  fireEvent.click(screen.getByRole('button', { name: /Kevin Elmurr/ }));
  fireEvent.click(screen.getByRole('button', { name: /Open conversation: Bank details changed/ }));
  expect(useViewer.getState().threadId).toBe('k1');
});

// ---- Full email viewer ----
const view: ThreadView = {
  threadId: 't1', subject: 'Invoice #1042', link: 'https://mail.google.com/mail/u/0/#all/t1',
  ai: { summary: 'Invoice 1042 for 3,450 USD is overdue.', category: 'billing', priority: 'high', needsReply: true, suggestedAction: 'Confirm the payment date', reason: 'Mentions an overdue invoice' },
  messages: [
    { gmailId: 'a', direction: 'in', date: '2026-11-12T10:00:00Z', from: { name: 'Lena Ortiz', email: 'lena@ortiz.example' }, to: [{ name: 'You', email: 'you@x.example' }], cc: [], body: 'Hi,\nInvoice 1042 is 3,450 USD.', attachments: [{ filename: 'Invoice-1042.pdf', mimeType: 'application/pdf', size: 45210, gmailId: 'a', attachmentId: 'att1', downloadable: true }] },
    { gmailId: 'b', direction: 'out', date: '2026-11-13T10:00:00Z', from: { name: 'You', email: 'you@x.example' }, to: [{ name: 'Lena Ortiz', email: 'lena@ortiz.example' }], cc: [], body: 'Paying Friday.', attachments: [] },
  ],
};

test('the viewer shows every message in full, the files, and the AI summary with its next step', async () => {
  vi.spyOn(api, 'thread').mockResolvedValue(structuredClone(view));
  render(<QueryClientProvider client={new QueryClient()}><EmailViewer /></QueryClientProvider>);
  act(() => useViewer.getState().open('t1'));
  expect(await screen.findByRole('heading', { name: 'Invoice #1042' })).toBeTruthy();
  expect(screen.getByText(/Invoice 1042 is 3,450 USD\./)).toBeTruthy();
  expect(screen.getByText('Paying Friday.')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Invoice-1042\.pdf/ }).getAttribute('href')).toBe('/api/attachments/a/att1');
  expect(screen.getByText('Invoice 1042 for 3,450 USD is overdue.')).toBeTruthy();
  expect(screen.getByText(/Confirm the payment date/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /Reply/ })).toBeTruthy();
});
