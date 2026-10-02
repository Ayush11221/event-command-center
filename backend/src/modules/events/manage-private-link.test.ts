import { describe, expect, it } from "vitest";
import {
  requirePrivateLinkMutation,
  requirePrivateLinkOwner,
} from "./manage-private-link.js";

describe("V9 private-link command guards", () => {
  it("accepts only the owning Organizer", () => {
    expect(() => requirePrivateLinkOwner(true)).not.toThrow();
    expect(() => requirePrivateLinkOwner(false)).toThrow(
      expect.objectContaining({ status: 403, code: "FORBIDDEN" }),
    );
  });
  it("accepts current PRIVATE Published revision", () => {
    expect(() =>
      requirePrivateLinkMutation(
        { state: "PUBLISHED", visibility: "PRIVATE", revision: 3 },
        3,
      ),
    ).not.toThrow();
  });
  it("reports stale revision before eligibility", () => {
    expect(() =>
      requirePrivateLinkMutation(
        { state: "LIVE", visibility: "PUBLIC", revision: 3 },
        2,
      ),
    ).toThrow(
      expect.objectContaining({
        status: 409,
        code: "VERSION_CONFLICT",
        details: { current_revision: 3 },
      }),
    );
  });
  it.each(["DRAFT", "LIVE", "COMPLETED", "CANCELLED"] as const)(
    "rejects %s",
    (state) => {
      expect(() =>
        requirePrivateLinkMutation(
          { state, visibility: "PRIVATE", revision: 3 },
          3,
        ),
      ).toThrow(
        expect.objectContaining({ status: 422, code: "WRONG_LIFECYCLE_STATE" }),
      );
    },
  );
  it.each(["PUBLIC", null] as const)("rejects visibility %s", (visibility) => {
    expect(() =>
      requirePrivateLinkMutation(
        { state: "PUBLISHED", visibility, revision: 3 },
        3,
      ),
    ).toThrow(
      expect.objectContaining({ status: 422, code: "WRONG_LIFECYCLE_STATE" }),
    );
  });
});
