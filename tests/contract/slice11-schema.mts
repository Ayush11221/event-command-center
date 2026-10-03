import { readFileSync } from "node:fs";
export const openapi = JSON.parse(
  readFileSync(
    new URL("../../docs/api/SLICE_11_OPENAPI.json", import.meta.url),
    "utf8",
  ),
);
type Schema = {
  $ref?: string;
  anyOf?: Schema[];
  allOf?: Schema[];
  if?: Schema;
  then?: Schema;
  else?: Schema;
  type?: string;
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
};
export function matchesSchema(s: Schema, v: unknown): boolean {
  if (s.$ref)
    return matchesSchema(
      openapi.components.schemas[s.$ref.split("/").at(-1)!],
      v,
    );
  if (s.anyOf && !s.anyOf.some((x) => matchesSchema(x, v))) return false;
  if (s.allOf && !s.allOf.every((x) => matchesSchema(x, v))) return false;
  if (s.if) {
    const branch = matchesSchema(s.if, v) ? s.then : s.else;
    if (branch && !matchesSchema(branch, v)) return false;
  }
  if (s.const !== undefined && s.const !== v) return false;
  if (s.enum && !s.enum.includes(v)) return false;
  if (
    s.type &&
    !(s.type === "null"
      ? v === null
      : s.type === "array"
        ? Array.isArray(v)
        : s.type === "object"
          ? v !== null && typeof v === "object" && !Array.isArray(v)
          : s.type === "integer"
            ? typeof v === "number" && Number.isSafeInteger(v)
            : typeof v === s.type)
  )
    return false;
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const data = v as Record<string, unknown>;
    if (
      (s.required ?? []).some((k) => !(k in data)) ||
      Object.keys(data).length < (s.minProperties ?? 0)
    )
      return false;
    for (const [k, x] of Object.entries(data)) {
      if (s.properties?.[k]) {
        if (!matchesSchema(s.properties[k], x)) return false;
      } else if (s.additionalProperties === false) return false;
    }
  }
  if (Array.isArray(v)) {
    if (
      v.length < (s.minItems ?? 0) ||
      v.length > (s.maxItems ?? Infinity) ||
      (s.uniqueItems &&
        new Set(v.map((x) => JSON.stringify(x))).size !== v.length)
    )
      return false;
    if (s.items && !v.every((x) => matchesSchema(s.items!, x))) return false;
  }
  if (
    typeof v === "number" &&
    (v < (s.minimum ?? -Infinity) || v > (s.maximum ?? Infinity))
  )
    return false;
  if (typeof v === "string") {
    if (
      [...v].length < (s.minLength ?? 0) ||
      [...v].length > (s.maxLength ?? Infinity) ||
      (s.pattern && !new RegExp(s.pattern).test(v))
    )
      return false;
    if (
      s.format === "uuid" &&
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
    )
      return false;
    if (s.format === "date-time" && !Number.isFinite(Date.parse(v)))
      return false;
  }
  return true;
}
