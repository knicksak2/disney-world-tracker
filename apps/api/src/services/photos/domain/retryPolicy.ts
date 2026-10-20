const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

export function nextAttemptAt(now: Date, attempts: number): Date {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  const exponent = safeAttempts - 1;
  const backoffMs = Math.min(ONE_MINUTE_MS * Math.pow(4, exponent), SIX_HOURS_MS);
  return new Date(now.getTime() + backoffMs);
}

export function shouldEscalate(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts;
}
