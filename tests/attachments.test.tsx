// The Attachments widget: a folder per sender, a folder per topic inside it, and each file with its date and a short
// summary of the email it came with.
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AttachmentFile } from '../src/lib/api';
import { DashboardDataProvider, type DashboardData } from '../src/dashboard/DataContext';
import { AttachmentsWidget } from '../src/widgets/AttachmentsWidget';

afterEach(cleanup);

let n = 0;
const file = (extra: Partial<AttachmentFile>): AttachmentFile => ({
  id: `f${++n}`, gmailId: `m${n}`, attachmentId: `a${n}`, filename: `file-${n}.pdf`, mimeType: 'application/pdf', size: 3000,
  direction: 'in', contact: 'Maroun Hanna', subject: 'Subject', at: '2026-11-14T10:00:00Z', link: null, downloadable: true,
  threadId: `t${n}`, sender: { name: 'Maroun Hanna', email: 'maroun@example.com' }, topic: 'request', summary: 'A summary',
  ...extra,
});

const kevin = { name: 'Kevin Elmurr', email: 'kevin@example.com' };
const items = [
  file({ filename: 'bill-of-lading.pdf', topic: 'request', summary: 'Customs needs a signed bill of lading.' }),
  file({ filename: 'damage-report.pdf', topic: 'support', summary: 'Pallet 3 arrived damaged.' }),
  file({ filename: 'manifest.csv', mimeType: 'text/csv', topic: 'request' }),
  file({ filename: 'invoice.pdf', sender: kevin, topic: 'billing' }),
  file({ filename: 'photo.jpg', mimeType: 'image/jpeg', sender: kevin, topic: null }),
];

function show(list = items) {
  const data = { attachments: { total: list.length, items: list } } as unknown as DashboardData;
  return render(<DashboardDataProvider value={data}><AttachmentsWidget widget={{ id: 'att', type: 'attachments', title: 'Attachments' }} /></DashboardDataProvider>);
}
const folder = (name: RegExp) => screen.getByRole('button', { name });

test('one folder per sender with their file count, most files first, all closed', () => {
  show();
  const senders = screen.getAllByRole('button', { name: /files from/ });
  expect(senders.map((b) => b.textContent)).toEqual([expect.stringMatching(/Maroun Hanna.*3/), expect.stringMatching(/Kevin Elmurr.*2/)]);
  for (const b of senders) expect(b.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('bill-of-lading.pdf')).toBeNull();
});

test('a sender folder holds a folder per topic', () => {
  show();
  fireEvent.click(folder(/Maroun Hanna/));
  const topics = screen.getAllByRole('button', { name: /files about/ });
  expect(topics.map((b) => b.textContent)).toEqual([expect.stringMatching(/Customer requests.*2/), expect.stringMatching(/Problems and complaints.*1/)]);
});

test('files without a topic go in "Other"', () => {
  show();
  fireEvent.click(folder(/Kevin Elmurr/));
  expect(folder(/Other, 1 files about/)).toBeTruthy();
});

test('each file shows its name, the date sent, a short summary of the email, and a download link', () => {
  show();
  fireEvent.click(folder(/Maroun Hanna/));
  fireEvent.click(folder(/Customer requests/));
  const row = screen.getByText('bill-of-lading.pdf').closest('li')!;
  expect(within(row).getByText('Customs needs a signed bill of lading.')).toBeTruthy();
  expect(within(row).getByText(/14 Nov|Nov 14/)).toBeTruthy();
  expect(within(row).getByRole('link', { name: /Download bill-of-lading\.pdf/ }).getAttribute('href')).toMatch(/^\/api\/attachments\//);
});

test('the file-type filter narrows the folders', () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: /^Images/ }));
  expect(screen.getAllByRole('button', { name: /files from/ }).map((b) => b.textContent)).toEqual([expect.stringMatching(/Kevin Elmurr.*1/)]);
});
