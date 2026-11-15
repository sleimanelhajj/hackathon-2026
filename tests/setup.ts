// Shared setup for the UI tests (Vitest + jsdom).
// jsdom doesn't implement <dialog>'s modal methods; the app's Modal uses them, so give it the same behaviour:
// showModal() opens, close() closes and fires "close".
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
