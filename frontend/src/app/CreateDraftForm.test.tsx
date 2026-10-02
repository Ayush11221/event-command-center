import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDraft, EventApiError } from "../services/events";
import { CreateDraftForm } from "./CreateDraftForm";

vi.mock("../services/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/events")>();
  return { ...actual, createDraft: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function form() {
  const onCreated = vi.fn();
  render(
    <CreateDraftForm
      csrf="csrf"
      onCreated={onCreated}
      onSessionExpired={vi.fn()}
      onForbidden={vi.fn()}
    />,
  );
  return onCreated;
}

describe("Draft creation", () => {
  it("sends only the name, retains revision-one success and clears the form", async () => {
    const onCreated = form();
    vi.mocked(createDraft).mockResolvedValue({
      event_id: "new-id",
      name: "Opening night",
      state: "DRAFT",
      revision: 1,
      as_of: "2030-01-01T00:00:00Z",
      correlation_id: "c",
    });
    fireEvent.change(screen.getByLabelText(/Event name/), {
      target: { value: "  Opening night  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Draft" }));
    expect(
      await screen.findByText(/Draft “Opening night” created/),
    ).toBeVisible();
    expect(vi.mocked(createDraft).mock.calls[0]?.[0]).toBe("Opening night");
    expect(vi.mocked(createDraft).mock.calls[0]?.[1]).toBe("csrf");
    expect(vi.mocked(createDraft).mock.calls[0]?.[2]).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(onCreated).toHaveBeenCalledWith("new-id");
    expect(screen.getByLabelText(/Event name/)).toHaveValue("");
  });

  it("keeps an unknown result bound to the same request and key on retry", async () => {
    form();
    vi.mocked(createDraft)
      .mockRejectedValueOnce(new EventApiError("NETWORK", 0))
      .mockResolvedValueOnce({
        event_id: "new-id",
        name: "Uncertain",
        state: "DRAFT",
        revision: 1,
        as_of: "now",
        correlation_id: "c",
      });
    fireEvent.change(screen.getByLabelText(/Event name/), {
      target: { value: "Uncertain" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Draft" }));
    expect(await screen.findByText(/result is unknown/)).toBeVisible();
    expect(screen.getByLabelText(/Event name/)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry same request" }));
    expect(await screen.findByText(/Draft “Uncertain” created/)).toBeVisible();
    expect(vi.mocked(createDraft).mock.calls[1]).toEqual(
      vi.mocked(createDraft).mock.calls[0],
    );
  });

  it("shows a field error without losing the entered name", async () => {
    form();
    vi.mocked(createDraft).mockRejectedValue(
      new EventApiError("VALIDATION", 400, "ref", { field: "name" }),
    );
    fireEvent.change(screen.getByLabelText(/Event name/), {
      target: { value: "Needs correction" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Draft" }));
    expect(
      await screen.findByText(/Enter a nonblank event name/),
    ).toBeVisible();
    expect(screen.getByLabelText(/Event name/)).toHaveValue("Needs correction");
    expect(screen.getByLabelText(/Event name/)).toHaveFocus();
  });

  it("uses the database's 200-character limit for Unicode names", async () => {
    form();
    const name = "🎟".repeat(201);
    fireEvent.change(screen.getByLabelText(/Event name/), {
      target: { value: name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Draft" }));
    expect(screen.getByText(/Enter a nonblank event name/)).toBeVisible();
    expect(createDraft).not.toHaveBeenCalled();
  });
});
