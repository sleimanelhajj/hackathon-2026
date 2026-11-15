// The Sales page: honest setup states, headline numbers with their change, no demo labels (decision #63), a period
// picker, and every chart section present.
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, type SalesDashboard, type SalesStatus, type SavedDashboard } from '../src/lib/api';
import { DEFAULT_SALES_SPEC } from '../shared/spec.js';
import SalesPage from '../src/pages/SalesPage';
import { ConfirmHost, dismissConfirm } from '../src/components/ConfirmDialog';

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
  // The widget panel portals into the shell's side-panel slot.
  if (!document.getElementById('side-panel')) document.body.insertAdjacentHTML('beforeend', '<aside id="side-panel"></aside>');
  vi.spyOn(api, 'spec').mockResolvedValue({ ...structuredClone(DEFAULT_SALES_SPEC), id: 'sales', version: 1, canUndo: false, updatedAt: '' } as SavedDashboard);
});
afterEach(() => { dismissConfirm(); cleanup(); });

const status = (s: Partial<SalesStatus>): SalesStatus => ({ configured: true, connected: true, counts: { customers: 180, products: 36, orders: 2724, deals: 320, reps: 8 }, error: null, ...s });

const dashboard: SalesDashboard = {
  sample: true,
  range: { from: '2025-12-01T00:00:00.000Z', to: '2026-11-14T12:00:00.000Z', months: 12, prevFrom: '2024-12-01T00:00:00.000Z', prevTo: '2025-11-14T12:00:00.000Z' },
  kpis: {
    revenue: 1_250_000, revenuePrev: 1_000_000, orders: 1500, ordersPrev: 1400, aov: 833.33, aovPrev: 714.29,
    marginPct: 42.5, marginPctPrev: 44, newCustomers: 60, newCustomersPrev: 50, winRate: 38.2, winRatePrev: 35,
    openPipeline: 420_000, openDeals: 45,
  },
  monthly: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, revenue: 100_000 + i * 1000, revenueLastYear: 80_000, orders: 120 })),
  byCategory: [{ key: 'Gift sets', revenue: 500_000, share: 40 }, { key: 'Devices', revenue: 750_000, share: 60 }],
  byRegion: [{ key: 'Levant', revenue: 700_000, share: 56 }, { key: 'Gulf', revenue: 550_000, share: 44 }],
  topProducts: [{ name: 'Barcode scanner X200', category: 'Devices', revenue: 300_000, units: 1000 }],
  topCustomers: [{ name: 'Cedar Retail', industry: 'Retail', region: 'Levant', revenue: 90_000, orders: 40 }],
  reps: [{ name: 'Lina Haddad', region: 'Levant', revenue: 400_000, target: 360_000, attainment: 111.1, won: 12 }],
  pipeline: [
    { stage: 'lead', count: 15, value: 100_000, open: true }, { stage: 'qualified', count: 12, value: 120_000, open: true },
    { stage: 'proposal', count: 10, value: 110_000, open: true }, { stage: 'negotiation', count: 8, value: 90_000, open: true },
    { stage: 'won', count: 40, value: 400_000, open: false }, { stage: 'lost', count: 60, value: 500_000, open: false },
  ],
  recentOrders: [{ number: 'SO-12724', customer: 'Cedar Retail', status: 'pending', channel: 'Direct', orderedAt: '2026-11-14T10:00:00Z', total: 1234.5 }],
};

function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SalesPage /></QueryClientProvider>);
}

test('without POSTGRES_URL it explains how to connect, and never shows numbers', async () => {
  vi.spyOn(api, 'salesStatus').mockResolvedValue(status({ configured: false, connected: false, counts: null }));
  const dash = vi.spyOn(api, 'salesDashboard');
  show();
  expect(await screen.findByText(/POSTGRES_URL/)).toBeTruthy();
  expect(dash).not.toHaveBeenCalled();
});

test('when Postgres refuses the connection it says why', async () => {
  vi.spyOn(api, 'salesStatus').mockResolvedValue(status({ connected: false, counts: null, error: 'Postgres refused the username or password in POSTGRES_URL.' }));
  show();
  expect(await screen.findByText(/refused the username or password/)).toBeTruthy();
});

test('connected but empty: one button loads the sales records, after a confirm', async () => {
  vi.spyOn(api, 'salesStatus').mockResolvedValue(status({ counts: null }));
  const seed = vi.spyOn(api, 'seedSales').mockResolvedValue({ ok: true, counts: status({}).counts! });
  show();
  render(<ConfirmHost />);
  fireEvent.click(await screen.findByRole('button', { name: /Load sales records/ }));
  expect(seed).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('alertdialog', { name: /Load the store.s sales records/ });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Load sales records' }));
  await waitFor(() => expect(seed).toHaveBeenCalledTimes(1));
});

test('shows the headline numbers with their change against last year, with no demo label', async () => {
  vi.spyOn(api, 'salesStatus').mockResolvedValue(status({}));
  vi.spyOn(api, 'salesDashboard').mockResolvedValue(structuredClone(dashboard));
  show();
  await screen.findByRole('heading', { name: 'Revenue' });
  const revenue = document.getElementById('widget-kpi-revenue')!;
  expect(within(revenue).getByText('$1.25M')).toBeTruthy();
  expect(within(revenue).getByText(/Up 25%/)).toBeTruthy();
  const margin = document.getElementById('widget-kpi-margin')!;
  expect(within(margin).getByText('42.5%')).toBeTruthy();
  expect(within(margin).getByText(/Down 1\.5 pts/)).toBeTruthy();
  expect(screen.queryByText(/demo data/i)).toBeNull();
});

test('has every section', async () => {
  vi.spyOn(api, 'salesStatus').mockResolvedValue(status({}));
  vi.spyOn(api, 'salesDashboard').mockResolvedValue(structuredClone(dashboard));
  show();
  for (const heading of ['Revenue by month', 'Revenue by category', 'Pipeline', 'Sales reps vs target', 'Top products', 'Top customers', 'Revenue by region', 'Recent orders'])
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
  expect(screen.getByText('Barcode scanner X200')).toBeTruthy();
  expect(screen.getByText('SO-12724')).toBeTruthy();
  expect(screen.getByText('111%')).toBeTruthy();
});

test('the period picker asks the server for that many months', async () => {
  vi.spyOn(api, 'salesStatus').mockResolvedValue(status({}));
  const dash = vi.spyOn(api, 'salesDashboard').mockResolvedValue(structuredClone(dashboard));
  show();
  await screen.findByRole('heading', { name: 'Revenue' });
  expect(dash).toHaveBeenLastCalledWith(12);
  const picker = screen.getByRole('combobox', { name: 'Period' });
  picker.focus();
  fireEvent.keyDown(picker, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: 'Last 3 months' }));
  await waitFor(() => expect(dash).toHaveBeenLastCalledWith(3));
});

test('it is a customisable board: Edit layout opens a panel with only sales widgets', async () => {
  vi.spyOn(api, 'salesStatus').mockResolvedValue(status({}));
  vi.spyOn(api, 'salesDashboard').mockResolvedValue(structuredClone(dashboard));
  show();
  await screen.findByRole('heading', { name: 'Revenue' });
  expect(api.spec).toHaveBeenCalledWith('sales');
  fireEvent.click(screen.getByRole('button', { name: /Edit layout/ }));
  expect(await screen.findByRole('button', { name: 'Add Sales number' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add Sales table' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add Contacts' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add Number' })).toBeNull();
});
