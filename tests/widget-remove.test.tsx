// Removing a widget from the dashboard: the Remove button opens the app's confirmation dialog; only "Remove widget"
// removes it. Cancel, Escape and the backdrop keep it. While editing, the settings box's Remove asks the same way.
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../src/widgets/registry", () => ({
  REGISTRY: { stat: { collapsible: false }, "sales-custom": { collapsible: true } },
  WidgetBody: () => <p>body</p>,
}));

import { WidgetFrame } from "../src/dashboard/WidgetFrame";
import { ConfirmHost, dismissConfirm } from "../src/components/ConfirmDialog";
import type { Widget } from "../src/lib/api";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { cleanup(); act(() => dismissConfirm()); });

const widget = { id: "ai-plumbing", type: "sales-custom", title: "Plumbing revenue by branch" } as unknown as Widget;
const noop = () => {};
function show({ editing = false, onRemoveSaved = vi.fn(), onRemove = vi.fn() } = {}) {
  render(<>
    <WidgetFrame widget={widget} editing={editing} collapsed={false} size={{ w: 6, h: 9 }}
      onToggleCollapse={noop} onRemove={onRemove} onChange={noop} onResize={noop} onMove={noop} onRemoveSaved={onRemoveSaved} />
    <ConfirmHost />
  </>);
  return { onRemoveSaved, onRemove };
}

test("the Remove button asks first; confirming removes the widget", async () => {
  const { onRemoveSaved } = show();
  fireEvent.click(screen.getByRole("button", { name: "Remove Plumbing revenue by branch" }));
  const dialog = await screen.findByRole("alertdialog", { name: 'Remove "Plumbing revenue by branch"?' });
  expect(dialog.textContent).toMatch(/You can undo this/);
  expect(onRemoveSaved).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove widget" }));
  await waitFor(() => expect(onRemoveSaved).toHaveBeenCalledWith("ai-plumbing"));
});

test("Cancel, Escape and the backdrop keep the widget", async () => {
  const { onRemoveSaved } = show();
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Remove Plumbing revenue by branch" }));
  open();
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  open();
  fireEvent(await screen.findByRole("alertdialog"), new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  open();
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.mouseDown(dialog, { target: dialog });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(onRemoveSaved).not.toHaveBeenCalled();
});

test("while editing, the settings box's Remove asks the same way (no second button on the header)", async () => {
  const { onRemove } = show({ editing: true });
  expect(screen.queryByRole("button", { name: "Remove Plumbing revenue by branch" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Configure Plumbing revenue by branch" }));
  fireEvent.click(screen.getByRole("button", { name: /Remove widget/ }));
  const dialog = await screen.findByRole("alertdialog");
  expect(onRemove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove widget" }));
  await waitFor(() => expect(onRemove).toHaveBeenCalledWith("ai-plumbing"));
});
