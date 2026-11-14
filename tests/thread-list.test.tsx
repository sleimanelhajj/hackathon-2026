// The two "waiting" lists say what their rule is when they're empty, so an empty list reads as correct, not broken.
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DashboardDataProvider, type DashboardData } from "../src/dashboard/DataContext";
import { ThreadListWidget } from "../src/widgets/ThreadListWidget";

afterEach(cleanup);

const empty = { awaitingYou: [], awaitingThem: [], insights: { rows: [] } } as unknown as DashboardData;
const show = (list: "awaitingYou" | "awaitingThem") =>
  render(
    <DashboardDataProvider value={empty}>
      <ThreadListWidget widget={{ id: "w", type: "thread-list", title: "t", list }} />
    </DashboardDataProvider>
  );

test("an empty 'Waiting on their reply' explains the 3-day rule", () => {
  show("awaitingThem");
  expect(screen.getByText("Nothing you sent has gone 3+ days without a reply.")).toBeTruthy();
  expect(screen.getByText(/Conversations show up here when you wrote last and they haven't answered for 3 days\./)).toBeTruthy();
});

test("an empty 'Waiting on your reply' explains its rule too", () => {
  show("awaitingYou");
  expect(screen.getByText("Nobody is waiting on you. Nice.")).toBeTruthy();
  expect(screen.getByText(/Conversations show up here when someone wrote last and you haven't answered\./)).toBeTruthy();
});
