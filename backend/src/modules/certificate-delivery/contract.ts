import { ApiError } from "../auth/errors.js";
import { objectBody, selection } from "../certificates/contract.js";
export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function batchRequest(value: unknown) {
  const body = objectBody(value, [
    "registration_ids",
    "template_id",
    "template_version",
    "font_id",
  ]);
  const ids = body.registration_ids;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== "string" || !uuid.test(id)) ||
    new Set(ids.map((id) => (id as string).toLowerCase())).size !== ids.length
  )
    throw new ApiError(
      422,
      "VALIDATION",
      "Select 1–100 distinct registration IDs",
    );
  const selected = selection({
    template_id: body.template_id,
    template_version: body.template_version,
    font_id: body.font_id,
  });
  return {
    ...selected,
    registration_ids: ids.map((id) => (id as string).toLowerCase()),
  };
}
export function itemQuery(query: Record<string, unknown>) {
  if (
    Object.keys(query).some((key) => key !== "limit" && key !== "cursor") ||
    (query.cursor !== undefined &&
      (typeof query.cursor !== "string" || !uuid.test(query.cursor))) ||
    (query.limit !== undefined &&
      (typeof query.limit !== "string" ||
        !/^[1-9]\d*$/.test(query.limit) ||
        Number(query.limit) > 100))
  )
    throw new ApiError(400, "VALIDATION", "Invalid pagination query");
  return {
    cursor: query.cursor as string | undefined,
    limit: query.limit === undefined ? 25 : Number(query.limit),
  };
}
