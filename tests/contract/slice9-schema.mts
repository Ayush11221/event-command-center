import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export const openapi = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../docs/api/SLICE_9_OPENAPI.json"),
    "utf8",
  ),
);
type Schema = {
  $ref?: string;
  oneOf?: Schema[];
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: unknown[];
  const?: unknown;
};
export function matchesSchema(schema: Schema, value: unknown): boolean {
  if (schema.$ref)
    return matchesSchema(
      openapi.components.schemas[schema.$ref.split("/").at(-1)!],
      value,
    );
  if (schema.oneOf)
    return (
      schema.oneOf.filter((item) => matchesSchema(item, value)).length === 1
    );
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null) return types.includes("null");
  if (Array.isArray(value))
    return (
      types.includes("array") &&
      value.every((item) => matchesSchema(schema.items!, item))
    );
  if (typeof value === "object") {
    if (!types.includes("object")) return false;
    const record = value as Record<string, unknown>,
      properties = schema.properties ?? {};
    return (
      (schema.required ?? []).every((key) => key in record) &&
      Object.entries(record).every(([key, item]) =>
        key in properties
          ? matchesSchema(properties[key], item)
          : schema.additionalProperties !== false,
      )
    );
  }
  return (
    types.includes(typeof value) ||
    (types.includes("integer") &&
      typeof value === "number" &&
      Number.isInteger(value))
  );
}
