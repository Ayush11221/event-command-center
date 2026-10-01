export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unavailable = () =>
  new ApiError(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable");
