import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SPEC } from '../shared/spec.js';
import { api, type Dashboard, type SavedDashboard } from '../src/lib/api';
import { DashboardPage } from '../src/pages/DashboardPage';
import { ConfirmHost, dismissConfirm } from '../src/components/ConfirmDialog';

vi.mock('../src/widgets/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/widgets/registry')>(),
  WidgetBody: () => null,
}));

let saved: SavedDashboard;
let saves: ReturnType<typeof vi.spyOn>;
let resets: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  saved = { ...structuredClone(DEFAULT_SPEC), id: 'default', version: 7, canUndo: false, updatedAt: '',
    layout: DEFAULT_SPEC.layout.map((item) => item.i === 'stat-awaiting-you' ? { ...item, y: 45 } : { ...item }),
  } as SavedDashboard;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(api, 'spec').mockImplementation(async () => structuredClone(saved));
  vi.spyOn(api, 'dashboard').mockResolvedValue({ connected: true, mode: 'sample', account: 'sample@example.test',
    status: 'connected', lastSyncAt: null, windowDays: 30, totals: { awaitingYou: 0 }, awaitingYou: [],
    insights: { configured: false, status: 'never', error: null, progress: null, lastRunAt: null, model: null, analysedThreads: 0, totalThreads: 0, categories: [], rows: [] },
  } as unknown as Dashboard);
  saves = vi.spyOn(api, 'saveSpec').mockImplementation(async (spec) => {
    saved = { ...structuredClone(spec), id: 'default', version: saved.version + 1, canUndo: true, updatedAt: '' };
    return structuredClone(saved);
  });
  resets = vi.spyOn(api, 'resetSpec');
  const slot = document.createElement('aside'); slot.id = 'side-panel'; document.body.append(slot);
});
afterEach(() => { act(() => dismissConfirm()); cleanup(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

async function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><DashboardPage /><ConfirmHost /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit layout', exact: true }));
  await waitFor(() => expect(document.querySelector('#widget-stat-awaiting-you')).not.toBeNull());
}
/** Cancel with unsaved changes asks first (a confirmation); answer it when it appears. */
async function discardIfAsked() {
  const ask = await screen.findByRole('alertdialog', { name: 'Discard your layout changes?' }).catch(() => null);
  if (ask) fireEvent.click(within(ask).getByRole('button', { name: 'Discard changes' }));
}
function tile() { return document.querySelector<HTMLElement>('#widget-stat-awaiting-you')!; }
/** Grid position GridStack holds for the tile, as "x,y". */
function pos() {
  const n = (tile() as HTMLElement & { gridstackNode?: { x?: number; y?: number } }).gridstackNode;
  return n ? `${n.x},${n.y}` : '';
}
function move() { fireEvent.keyDown(screen.getByRole('button', { name: 'Move Waiting on you', exact: true }), { key: 'ArrowRight' }); }
async function resetPreview() {
  fireEvent.click(screen.getByRole('button', { name: 'Reset', exact: true }));
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Reset this layout to the default?' })).getByRole('button', { name: 'Reset preview' }));
  await waitFor(() => expect(pos()).toBe('0,0'));
}

describe('dashboard edit transactions with the real grid', () => {
  test('Cancel discards movement, makes no save call, and a new edit starts from the saved arrangement', async () => {
    await open();
    await waitFor(() => expect(pos()).toBe('0,45'));
    const original = pos();
    move();
    await waitFor(() => expect(pos()).not.toBe(original));
    const oldGrid = document.querySelector('.dashboard-layout');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await discardIfAsked();
    await screen.findByRole('button', { name: 'Edit layout', exact: true });
    expect(saves).not.toHaveBeenCalled(); expect(resets).not.toHaveBeenCalled();
    expect(document.querySelector('.dashboard-layout')).not.toBe(oldGrid);
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout', exact: true }));
    await waitFor(() => expect(pos()).toBe(original));
    expect(saved.layout[0].y).toBe(45);
  });

  test('Reset works after Cancel and changes only the draft until Save', async () => {
    await open(); move();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await discardIfAsked();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit layout', exact: true }));
    await resetPreview();
    expect(saved.layout[0].y).toBe(45);
    expect(saves).not.toHaveBeenCalled(); expect(resets).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save layout', exact: true }));
    await screen.findByText('Layout saved', { exact: true });
    expect(saved.layout).toEqual(DEFAULT_SPEC.layout);
    expect(saves).toHaveBeenCalledTimes(1);
  });

  test('Cancel also discards a Reset preview', async () => {
    await open(); await resetPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await discardIfAsked();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit layout', exact: true }));
    await waitFor(() => expect(pos()).toBe('0,45'));
    expect(saves).not.toHaveBeenCalled(); expect(resets).not.toHaveBeenCalled();
  });

  test('library entries are registered with GridStack as new widgets of their catalogue size', async () => {
    await open();
    const source = screen.getByRole('button', { name: 'Add Number', exact: true }).previousElementSibling as HTMLElement & { gridstackNode?: unknown };
    await waitFor(() => expect(source.gridstackNode).toMatchObject({ id: 'new:stat', w: 3, h: 3 }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(saves).not.toHaveBeenCalled();
    expect(saved.widgets.length).toBe(DEFAULT_SPEC.widgets.length);
  });

  test('Cancel is disabled while an explicit Save is in flight', async () => {
    let finish!: (value: SavedDashboard) => void;
    saves.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await open(); move();
    fireEvent.click(screen.getByRole('button', { name: 'Save layout', exact: true }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Cancel', exact: true }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Reset', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('.dashboard-canvas')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('#widget-library')?.hasAttribute('inert')).toBe(true);
    finish({ ...saved, version: 8 });
    await screen.findByText('Layout saved', { exact: true });
  });
});
