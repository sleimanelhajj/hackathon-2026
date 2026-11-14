// The app's dropdown (src/components/Select.tsx, built on Radix UI Select): readable, keyboard-friendly,
// and an "anything" option that maps to an empty value.
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Select } from '../src/components/Select';

beforeAll(() => {
  // jsdom lacks the pointer and scrolling APIs Radix calls.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const options = [
  { value: '', label: 'Any priority' },
  { value: 'high', label: 'High priority' },
  { value: 'low', label: 'Low priority' },
];

function open(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
}

test('shows the chosen option and names itself for screen readers', () => {
  render(<Select label="Priority" value="high" onChange={() => {}} options={options} />);
  const trigger = screen.getByRole('combobox', { name: 'Priority' });
  expect(trigger.textContent).toContain('High priority');
});

test('shows the "any" option when the value is empty, and marks the trigger inactive', () => {
  render(<Select label="Priority" value="" onChange={() => {}} options={options} />);
  const trigger = screen.getByRole('combobox', { name: 'Priority' });
  expect(trigger.textContent).toContain('Any priority');
  expect(trigger.getAttribute('data-active')).toBe('false');
});

test('choosing an option reports its value', async () => {
  const onChange = vi.fn();
  render(<Select label="Priority" value="" onChange={onChange} options={options} />);
  open(screen.getByRole('combobox', { name: 'Priority' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Low priority' }));
  expect(onChange).toHaveBeenCalledWith('low');
});

test('choosing the "any" option reports an empty value', async () => {
  const onChange = vi.fn();
  render(<Select label="Priority" value="high" onChange={onChange} options={options} />);
  open(screen.getByRole('combobox', { name: 'Priority' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Any priority' }));
  expect(onChange).toHaveBeenCalledWith('');
});

test('opens from the keyboard', async () => {
  render(<Select label="Priority" value="" onChange={() => {}} options={options} />);
  const trigger = screen.getByRole('combobox', { name: 'Priority' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(await screen.findByRole('listbox')).toBeTruthy();
});
