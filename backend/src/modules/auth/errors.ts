export interface ApiErrorOptions {
  details?: Readonly<Record<string, unknown>>;
  retryable?: boolean;
}

export class ApiError extends Error {
  public readonly details?: Readonly<Record<string, unknown>>;
  public readonly retryable?: boolean;

  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    options: ApiErrorOptions = {},
  ) {
    super(message);
    this.details = options.details;
    this.retryable = options.retryable;
  }
}

export const unavailable = () =>
  new ApiError(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable", {
    retryable: true,
  });
