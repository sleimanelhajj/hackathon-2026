// Removing a widget from the dashboard by clicking: a Remove button on each widget opens a confirmation; only the
// confirm button removes it. Cancel, Escape and clicking elsewhere keep it.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../src/widgets/registry", () => ({
  REGISTRY: { stat: { collapsible: false }, "sales-custom": { collapsible: true } },
  WidgetBody: () => <p>body</p>,
}));

import { WidgetFrame } from "../src/dashboard/WidgetFrame";
import type { Widget } from "../src/lib/api";

afterEach(cleanup);

const widget = { id: "ai-plumbing", type: "sales-custom", title: "Plumbing revenue by branch" } as unknown as Widget;
const noop = () => {};
function show(onRemoveSaved = vi.fn(), editing = false) {
  render(<WidgetFrame widget={widget} editing={editing} collapsed={false} size={{ w: 6, h: 9 }}
    onToggleCollapse={noop} onRemove={noop} onChange={noop} onResize={noop} onMove={noop} onRemoveSaved={onRemoveSaved} />);
  return onRemoveSaved;
}

test("the Remove button asks first; confirming removes the widget", () => {
  const remove = show();
  fireEvent.click(screen.getByRole("button", { name: "Remove Plumbing revenue by branch" }));
  const dialog = screen.getByRole("alertdialog", { name: "Remove Plumbing revenue by branch?" });
  expect(dialog.textContent).toMatch(/You can undo this/);
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove widget" }));
  expect(remove).toHaveBeenCalledWith("ai-plumbing");
});

test("Cancel and Escape keep the widget", () => {
  const remove = show();
  fireEvent.click(screen.getByRole("button", { name: "Remove Plumbing revenue by branch" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove Plumbing revenue by branch" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(remove).not.toHaveBeenCalled();
});

test("clicking elsewhere closes the confirmation without removing", () => {
  const remove = show();
  fireEvent.click(screen.getByRole("button", { name: "Remove Plumbing revenue by branch" }));
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(remove).not.toHaveBeenCalled();
});

test("while editing the layout, removal stays in the widget's settings (no second button)", () => {
  show(vi.fn(), true);
  expect(screen.queryByRole("button", { name: "Remove Plumbing revenue by branch" })).toBeNull();
});
