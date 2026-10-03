import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { batchRequest, itemQuery } from "./contract.js";
const selection = {
  template_id: "classic",
  template_version: 1,
  font_id: "sans",
};
it.each(
  [
    [],
    [
      randomUUID(),
      randomUUID(),
      ...Array.from({ length: 99 }, () => randomUUID()),
    ],
    ["not-a-uuid"],
  ].map((ids) => ({ ids })),
)("rejects invalid bounded selection $ids", ({ ids }) => {
  expect(() => batchRequest({ ...selection, registration_ids: ids })).toThrow(
    expect.objectContaining({ status: 422, code: "VALIDATION" }),
  );
});
it("rejects duplicates including UUID case variants and unknown JSON fields", () => {
  const id = randomUUID();
  expect(() =>
    batchRequest({ ...selection, registration_ids: [id, id.toUpperCase()] }),
  ).toThrow();
  expect(() =>
    batchRequest({
      ...selection,
      registration_ids: [id],
      email: "leak@example.invalid",
    }),
  ).toThrow();
});
it("accepts exactly 100 distinct IDs and bounded cursor pagination", () => {
  expect(
    batchRequest({
      ...selection,
      registration_ids: Array.from({ length: 100 }, () => randomUUID()),
    }).registration_ids,
  ).toHaveLength(100);
  expect(itemQuery({})).toEqual({ limit: 25 });
  expect(itemQuery({ limit: "100", cursor: randomUUID() })).toHaveProperty(
    "limit",
    100,
  );
});
it.each([
  { limit: "0" },
  { limit: "101" },
  { limit: "1.5" },
  { limit: ["1"] },
  { cursor: "bad" },
  { email: "x" },
])("rejects unsafe pagination %j", (query) => {
  expect(() => itemQuery(query)).toThrow();
});
