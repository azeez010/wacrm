import crypto from 'node:crypto'

// Code generation and hashing for OTP verifications. Pure, no I/O.
//
// The code is never stored. We keep HMAC-SHA256(secret, "otp:<id>:<code>"):
// binding the verification id means one leaked hash can't be replayed against
// another verification, and the server secret means a database leak alone
// can't be brute-forced offline (a 6-digit code has only 10^6 possibilities).

export const OTP_LIMITS = {
  codeLengthMin: 4,
  codeLengthMax: 8,
  codeLengthDefault: 6,
  ttlMinSeconds: 60,
  ttlMaxSeconds: 900,
  ttlDefaultSeconds: 300,
  maxAttempts: 5,
  /** Sends allowed per phone number per account inside the window. */
  throttleMax: 5,
  throttleWindowSeconds: 600,
  /** A caller-supplied code (Meta allows up to 15 alphanumerics). */
  providedCodeMin: 4,
  providedCodeMax: 15,
  metadataMaxBytes: 1024,
} as const

/** A random numeric code, leading zeros preserved ("004821"). */
export function generateOtpCode(length: number = OTP_LIMITS.codeLengthDefault): string {
  let out = ''
  for (let i = 0; i < length; i++) out += crypto.randomInt(0, 10).toString()
  return out
}

/** True for a code a caller may bring themselves (alphanumeric, 4 to 15). */
export function isAcceptableProvidedCode(code: unknown): code is string {
  return (
    typeof code === 'string' &&
    code.length >= OTP_LIMITS.providedCodeMin &&
    code.length <= OTP_LIMITS.providedCodeMax &&
    /^[A-Za-z0-9]+$/.test(code)
  )
}

function secret(): string {
  const s = process.env.OTP_HMAC_SECRET || process.env.ENCRYPTION_KEY
  if (!s) throw new Error('OTP_HMAC_SECRET (or ENCRYPTION_KEY) is not configured')
  return s
}

export function hashOtp(verificationId: string, code: string): string {
  return crypto.createHmac('sha256', secret()).update(`otp:${verificationId}:${code}`).digest('hex')
}

/** Constant-time comparison of a submitted code against a stored hash. */
export function verifyOtp(verificationId: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashOtp(verificationId, code), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
