// Shared UI building blocks: one accessible glass Modal, a confirm() that can run the action (busy + error inside the
// dialog), toasts, and plain-language errors.
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Modal } from "../src/components/Modal";
import { ConfirmHost, confirm, dismissConfirm } from "../src/components/ConfirmDialog";
import { Toaster, toast } from "../src/components/Toaster";
import { ApiError, errorMessage, messageForStatus } from "../src/lib/errors";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { cleanup(); act(() => { toast.clear(); dismissConfirm(); }); });

function ModalDemo({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit hours" description="Your working hours" dismissible={dismissible}
        footer={<button onClick={() => setOpen(false)}>Done</button>}>
        <p>Body text</p>
      </Modal>
    </>
  );
}

test("the modal is a labelled dialog with its title and description, and nothing renders while closed", () => {
  render(<ModalDemo />);
  expect(screen.queryByText("Body text")).toBeNull();
  fireEvent.click(screen.getByText("Open it"));
  const dialog = screen.getByRole("dialog", { name: "Edit hours" });
  expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
  expect(screen.getByText("Your working hours")).toBeTruthy();
  expect(screen.getByText("Body text")).toBeTruthy();
  expect(document.documentElement.classList.contains("modal-open")).toBe(true);
});

test("Escape and the close button close it, and focus goes back to the button that opened it", async () => {
  render(<ModalDemo />);
  const opener = screen.getByText("Open it");
  opener.focus();
  fireEvent.click(opener);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(opener);
  expect(document.documentElement.classList.contains("modal-open")).toBe(false);
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a modal that must not be dismissed ignores Escape and has no close button", () => {
  render(<ModalDemo dismissible={false} />);
  fireEvent.click(screen.getByText("Open it"));
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
});

test("confirm() resolves true on confirm and false on cancel", async () => {
  render(<ConfirmHost />);
  let answer: Promise<boolean>;
  act(() => { answer = confirm({ title: "Delete this page?", message: "Its widgets go too.", confirmLabel: "Delete page", tone: "danger" }); });
  const dialog = await screen.findByRole("alertdialog", { name: "Delete this page?" });
  expect(dialog.textContent).toMatch(/Its widgets go too/);
  fireEvent.click(screen.getByRole("button", { name: "Delete page" }));
  await expect(answer!).resolves.toBe(true);

  act(() => { answer = confirm({ title: "Send it?" }); });
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  await expect(answer!).resolves.toBe(false);
});

test("confirm() with an action shows progress, keeps the dialog open with the error on failure, and closes on success", async () => {
  render(<ConfirmHost />);
  let attempts = 0;
  const action = vi.fn(async () => { attempts++; if (attempts === 1) throw new Error("Gmail refused the message."); });
  let answer: Promise<boolean>;
  act(() => { answer = confirm({ title: "Send this reply?", confirmLabel: "Send reply", action }); });
  fireEvent.click(await screen.findByRole("button", { name: "Send reply" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText(/Gmail refused the message/)).toBeTruthy();
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
  await expect(answer!).resolves.toBe(true);
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(action).toHaveBeenCalledTimes(2);
});

test("toasts are announced, errors stay until dismissed, and they can be closed", async () => {
  vi.useFakeTimers();
  render(<Toaster />);
  act(() => { toast.success("Reply sent", "To kevin@client.example"); toast.error("Couldn't save", "Check your connection."); });
  expect(screen.getByText("Reply sent")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toMatch(/Couldn't save/);
  act(() => { vi.advanceTimersByTime(6000); });
  expect(screen.queryByText("Reply sent")).toBeNull();
  expect(screen.getByText("Couldn't save")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss: Couldn't save" }));
  expect(screen.queryByText("Couldn't save")).toBeNull();
  vi.useRealTimers();
});

test("errors are plain words: the server's message first, a friendly one by status otherwise", () => {
  expect(errorMessage(new ApiError("Gmail isn't connected.", 400))).toBe("Gmail isn't connected.");
  expect(errorMessage("weird")).toBe("Something went wrong. Please try again.");
  expect(messageForStatus(429)).toMatch(/too many/i);
  expect(messageForStatus(503)).toMatch(/server/i);
  expect(messageForStatus(404)).toMatch(/not found|no longer/i);
  expect(messageForStatus(0)).toMatch(/connection/i);
});
