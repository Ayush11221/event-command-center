import { readFileSync } from "node:fs";
export const openapi = JSON.parse(
  readFileSync(
    new URL("../../docs/api/SLICE_10_OPENAPI.json", import.meta.url),
    "utf8",
  ),
);
type Schema = {
  $ref?: string;
  oneOf?: Schema[];
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
  maximum?: number;
  format?: string;
};
export function matchesSchema(schema: Schema, value: unknown): boolean {
  if (schema.$ref)
    return matchesSchema(
      openapi.components.schemas[schema.$ref.split("/").at(-1)!],
      value,
    );
  if (schema.oneOf)
    return schema.oneOf.filter((s) => matchesSchema(s, value)).length === 1;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.const !== undefined && value !== schema.const) return false;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null) return types.includes("null");
  if (Array.isArray(value))
    return (
      types.includes("array") &&
      value.length >= (schema.minItems ?? 0) &&
      value.length <= (schema.maxItems ?? Infinity) &&
      (!schema.uniqueItems ||
        new Set(value.map((v) => JSON.stringify(v))).size === value.length) &&
      value.every((v) => matchesSchema(schema.items!, v))
    );
  if (typeof value === "object")
    return (
      types.includes("object") &&
      (schema.required ?? []).every((key) => key in value) &&
      Object.entries(value).every(([key, v]) =>
        schema.properties?.[key]
          ? matchesSchema(schema.properties[key], v)
          : schema.additionalProperties !== false,
      )
    );
  if (typeof value === "number")
    return (
      (types.includes("number") ||
        (types.includes("integer") && Number.isInteger(value))) &&
      value >= (schema.minimum ?? -Infinity) &&
      value <= (schema.maximum ?? Infinity)
    );
  if (
    typeof value === "string" &&
    schema.format === "uuid" &&
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
  )
    return false;
  if (
    typeof value === "string" &&
    schema.format === "date-time" &&
    !Number.isFinite(Date.parse(value))
  )
    return false;
  return types.includes(typeof value);
}
