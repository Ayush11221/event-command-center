import { describe, expect, it } from "vitest";
import { profileInput } from "./profile.js";
describe("profile input boundary", () => {
  it("accepts and trims Unicode names and self-reported contact details", () =>
    expect(
      profileInput({
        display_name: "  आशा Rao  ",
        phone_number: "+91 98765 43210",
        organization: " College ",
        affiliation_id: " ST-1 ",
      }),
    ).toEqual({
      display_name: "आशा Rao",
      phone_number: "+919876543210",
      organization: "College",
      affiliation_id: "ST-1",
    }));
  it.each([null, [], {}, { display_name: 1 }])(
    "rejects malformed input %#",
    (body) => expect(() => profileInput(body)).toThrow(),
  );
  it.each([
    { display_name: " " },
    { display_name: "x".repeat(101) },
    { display_name: "a\u0000b" },
    { display_name: "a\u202Eb" },
    { role: "ADMIN" },
    { phone_number: "123" },
    { phone_number: "9".repeat(16) },
    { phone_number: "555-abc-defg" },
    { organization: " " },
    { organization: "x".repeat(121) },
    { affiliation_id: "x".repeat(65) },
    { affiliation_id: "a\u0000b" },
  ])("rejects invalid or privileged values %#", (change) =>
    expect(() =>
      profileInput({
        display_name: "Name",
        phone_number: "9876543210",
        organization: "College",
        ...change,
      }),
    ).toThrow(),
  );
});
