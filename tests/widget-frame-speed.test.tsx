// Editing the dashboard: moving one card hands every card a fresh layout object. Cards whose size didn't change must
// not redraw their contents (charts, long lists), or every drop and resize redraws the whole board.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/widgets/registry', () => ({
  REGISTRY: { stat: { collapsible: false } },
  WidgetBody: () => { renders.count++; return <p>body</p>; },
}));

import { WidgetFrame } from '../src/dashboard/WidgetFrame';
import type { Widget } from '../src/lib/api';

afterEach(cleanup);

const widget = { id: 'w1', type: 'stat', title: 'Starred' } as unknown as Widget;
const noop = () => {};
const props = { widget, editing: true, collapsed: false, onToggleCollapse: noop, onRemove: noop, onChange: noop, onResize: noop, onMove: noop };

test('a card whose size is unchanged does not redraw when another card moves', () => {
  renders.count = 0;
  const { rerender } = render(<WidgetFrame {...props} size={{ w: 4, h: 3 }} />);
  rerender(<WidgetFrame {...props} size={{ w: 4, h: 3 }} />);
  rerender(<WidgetFrame {...props} size={{ i: 'w1', x: 5, y: 9, w: 4, h: 3 } as never} />);
  expect(renders.count).toBe(1);
});

test('a card does redraw when its own size changes', () => {
  renders.count = 0;
  const { rerender } = render(<WidgetFrame {...props} size={{ w: 4, h: 3 }} />);
  rerender(<WidgetFrame {...props} size={{ w: 6, h: 3 }} />);
  expect(renders.count).toBe(2);
});
