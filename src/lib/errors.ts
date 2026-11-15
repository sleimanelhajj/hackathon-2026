/** An error from our API, with the HTTP status (0 = the server couldn't be reached). */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** A plain-language message for a status when the server didn't send one. */
export function messageForStatus(status: number): string {
  if (status === 0) return "Can't reach the server. Check your connection and try again.";
  if (status === 401 || status === 403) return "You don't have access to that. Reconnect your account and try again.";
  if (status === 404) return "That's no longer there. Refresh the page and try again.";
  if (status === 409) return "This changed somewhere else. Refresh the page to get the latest version.";
  if (status === 413) return "That's too large to send.";
  if (status === 429) return "Too many requests right now. Wait a moment and try again.";
  if (status >= 500) return "The server had a problem. Please try again in a moment.";
  return "That didn't work. Please try again.";
}

/** The message to show for any thrown value. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}
