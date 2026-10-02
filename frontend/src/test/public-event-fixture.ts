import type {
  PublicCatalogResponse,
  PublicDetail,
} from "../services/discovery";

export function publicDetailFixture(
  overrides: Partial<PublicDetail> = {},
): PublicDetail {
  return {
    event_id: "public-one",
    name: "Community conference",
    description: "A day of talks and shared ideas.",
    start_at: "2030-01-01T10:00:00Z",
    end_at: "2030-01-01T12:00:00Z",
    time_zone: "Asia/Kolkata",
    public_location: "City hall",
    image_url: "https://example.org/banner.png",
    category: "Conference",
    tags: ["Community", "Research"],
    availability: {
      policy_status: "OPEN",
      reasons: [],
      opens_at: null,
      closes_at: "2030-01-01T14:00:00Z",
      as_of: "2026-10-02T12:00:00Z",
    },
    as_of: "2026-10-02T12:00:00Z",
    correlation_id: "public-ref",
    ...overrides,
  };
}
export function publicCatalogFixture(
  overrides: Partial<PublicCatalogResponse> = {},
): PublicCatalogResponse {
  return {
    items: [publicDetailFixture()],
    next_cursor: null,
    as_of: "2026-10-02T12:00:00Z",
    correlation_id: "catalog-ref",
    ...overrides,
  };
}
