export function authAvailability(error: {
  status?: number;
  code?: string;
  name?: string;
} | null): 429 | 503 | undefined {
  if (!error) return;
  if (error.status === 429 || error.code === "over_request_rate_limit")
    return 429;
  if (
    error.status === 408 ||
    (error.status !== undefined && error.status >= 500) ||
    error.name === "AuthRetryableFetchError"
  )
    return 503;
}
