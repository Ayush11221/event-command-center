import { describe, expect, it } from "vitest";
import {
  parseRegistrationReference,
  parseRegistrationSelection,
} from "./registration-reference";
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  origin = "https://example.test";
describe("certificate registration selection", () => {
  it("accepts a registration ID and same-site registration page links", () => {
    for (const input of [
      id,
      ` ${origin}/registrations/${id} `,
      `/registrations/${id}`,
    ])
      expect(parseRegistrationReference(input, origin)).toBe(id);
    expect(
      parseRegistrationSelection(
        `${id},\n${origin}/registrations/${other}`,
        origin,
      ),
    ).toEqual([id, other]);
  });
  it.each([
    "entry.secret.credential",
    "Participant name",
    "/events/" + id,
    "https://other.test/registrations/" + id,
    "https://user:password@example.test/registrations/" + id,
    `/registrations/${id}?token=private`,
    `/registrations/${id}#private`,
    "",
    "/registrations/not-an-id",
  ])("rejects unrelated or credential input without repeating it", (value) => {
    expect(() => parseRegistrationReference(value, origin)).toThrow(
      "Paste a registration page link or registration ID.",
    );
  });
  it("rejects duplicate selection and sizes outside the explicit batch bound", () => {
    expect(() =>
      parseRegistrationSelection(`${id},/registrations/${id}`, origin),
    ).toThrow("only once");
    expect(() => parseRegistrationSelection("", origin)).toThrow(
      "between 1 and 100",
    );
    expect(() =>
      parseRegistrationSelection(Array(101).fill(id).join("\n"), origin),
    ).toThrow("between 1 and 100");
  });
});
