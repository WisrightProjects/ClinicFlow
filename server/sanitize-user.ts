// Strips credential fields from every JSON response before it leaves the server.
//
// The storage layer selects whole rows (`db.select().from(users)`) and then NESTS them inside
// other objects — an appointment carries `doctor` and `patient`, a schedule carries `doctor`,
// a favourite carries `doctor`. So a scrypt `password` or `mpin` hash can surface at any depth
// of almost any response, and the first version of this file — a shallow strip applied at
// hand-picked call sites — missed most of them. One of those call sites was a no-op: it
// sanitized the top level of a row whose user object hung off a `doctor` key underneath.
//
// Hence: recursive, and applied once at the response layer rather than per handler. A list of
// call sites is only ever as complete as the last person to grep; a chokepoint covers the
// endpoint nobody thought to check.
//
// Why this matters more than ordinary PII: a patient MPIN is exactly four digits
// (`/^\d{4}$/` in auth.ts) and patient login is mobile number + MPIN. A leaked MPIN hash is a
// 10,000-candidate offline search, so disclosing one is account takeover, not disclosure.
//
// A denylist, not an allowlist, because responses carry arbitrary shapes and an allowlist
// would silently blank fields the UI needs. Verified before adopting the blanket strip: no
// file under client/src reads any of these fields from an API payload, and no endpoint
// returns a plaintext password (the one screen that displays one reads its own form state).

/** Fields that must never reach a client, at any depth. */
const SENSITIVE_FIELDS = new Set([
  'password',
  'mpin',
  // Not secrets, but they describe the MPIN lockout that protects the account: publishing
  // how many attempts remain, or when a lock lifts, helps an attacker time their guesses.
  'mpinAttempts',
  'mpinLockedUntil',
  'lastMpinChange',
  'lastOtpSentAt',
]);

/** Depth cap, so a cyclic or pathological structure cannot spin here. */
const MAX_DEPTH = 8;

/**
 * Returns a copy of `value` with every sensitive field removed, at any depth.
 *
 * Non-plain objects (Date, Buffer and anything else with a custom prototype) are returned as
 * they are: they hold no user fields and copying them by enumeration would corrupt them —
 * a Date spread into a plain object serialises as `{}`.
 */
export function stripSensitive<T>(value: T, depth = 0, fields: Set<string> = SENSITIVE_FIELDS): T {
  if (value === null || typeof value !== 'object') return value;
  // Fails CLOSED past the cap. Returning the subtree unscrubbed would let a future nesting
  // change silently reopen this, which is exactly how the first version of this fix went
  // wrong. Nothing real is near the cap (the deepest response nests a user at 6), so
  // dropping the value is a louder failure than leaking it.
  if (depth > MAX_DEPTH) return undefined as unknown as T;

  if (Array.isArray(value)) {
    return value.map((item) => stripSensitive(item, depth + 1, fields)) as unknown as T;
  }

  // Opaque by design: these carry no user fields and copying them by enumeration would
  // corrupt them (a Date rebuilt as a plain object serialises as `{}`).
  if (value instanceof Date || value instanceof RegExp || Buffer.isBuffer(value)) return value;

  // Everything else is walked, INCLUDING class instances. An earlier version returned any
  // non-plain object untouched, which fails open: handing a node-postgres `Result` straight
  // to res.json would have serialised `.rows` with the hashes intact and defeated the one
  // mechanism this all rests on. Walking own enumerable keys turns it into a plain object,
  // which is what JSON.stringify would have produced anyway.

  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(value as Record<string, any>)) {
    if (fields.has(key)) continue;
    clean[key] = stripSensitive(val, depth + 1, fields);
  }
  return clean as T;
}

/** Back-compat aliases for the call sites that already use these names. */
export const sanitizeUser = stripSensitive;
export const sanitizeUsers = stripSensitive;

/**
 * Extra fields removed from responses served to ANONYMOUS callers.
 *
 * Not in SENSITIVE_FIELDS because staff screens legitimately read them — the admin console
 * lists usernames, and the client checks `mustChangePassword` after login. They are stripped
 * only where there is no session, because together they are a targeting list: `username` is
 * the login identifier for POST /api/login, and `mustChangePassword` marks precisely the
 * accounts still sitting on an admin-issued initial password.
 */
const PUBLIC_FIELDS = new Set([
  ...SENSITIVE_FIELDS,
  'username',
  'mustChangePassword',
  'bypassNearby',
  'phoneVerified',
]);

/**
 * Strips credentials AND the internal flags above. For public, unauthenticated responses.
 *
 * A separate frozen set rather than temporarily mutating SENSITIVE_FIELDS: that trick only
 * holds while this function is synchronous, and would quietly blank usernames across the
 * admin console the day someone adds an await.
 */
export function stripForPublic<T>(value: T): T {
  return stripSensitive(value, 0, PUBLIC_FIELDS);
}
