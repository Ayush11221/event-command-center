import { expect, it } from "vitest";
import { openapi } from "../../../../tests/contract/slice9-schema.mjs";
it("publishes exactly the eight approved operations with closed role-specific representations", () => {
  const operations = Object.values(openapi.paths).flatMap((path) =>
    Object.values(path as object),
  );
  expect(operations).toHaveLength(8);
  for (const name of [
    "OwnerStatus",
    "StaffStatus",
    "IssueWork",
    "NameCommand",
    "Selection",
    "OwnerCertificate",
    "StaffCertificate",
  ])
    expect(openapi.components.schemas[name].additionalProperties).toBe(false);
  expect(openapi.components.schemas.StaffStatus.properties).not.toHaveProperty(
    "recipient_name",
  );
  expect(
    openapi.components.schemas.StaffCertificate.properties,
  ).not.toHaveProperty("recipient_name");
  expect(
    openapi.components.schemas.StaffCertificate.properties,
  ).not.toHaveProperty("pdfBytes");
});
