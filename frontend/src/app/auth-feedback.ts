import { ProofError } from "../services/proof";
export function accessMessage(error: unknown, expired = false): string {
  if (
    expired ||
    (error instanceof ProofError && error.code === "SESSION_EXPIRED")
  )
    return "Your session has expired. Sign in again to continue.";
  if (error instanceof ProofError && error.status === 401)
    return "You need to sign in to continue.";
  if (error instanceof ProofError && error.status === 403)
    return "You don't have permission to do this.";
  return "We couldn't verify your access right now. Please try again.";
}
export function verificationMessage(error: unknown, sending: boolean): string {
  if (error instanceof ProofError) {
    if (error.code === "ACCOUNT_SWITCH_REQUIRED")
      return "Sign out of your account before continuing without an account.";
    if (error.code === "SESSION_EXPIRED") return accessMessage(error);
    if (error.status === 429)
      return sending
        ? "Too many verification requests. Please try again later."
        : "Too many attempts. Request a new verification code.";
    if (!sending && error.status === 401)
      return "The code is incorrect or has expired. Check your email or messages and try again, or request a new code.";
    if (error.status === 403) return accessMessage(error);
    if (sending && error.status === 400)
      return "Check your email address or phone number and try again.";
  }
  return sending
    ? "We couldn't send the code right now. Please try again."
    : "We couldn't verify the code right now. Please try again.";
}
