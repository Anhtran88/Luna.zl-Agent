/** Better Auth database lookup, never a client-claimed identity or cached cookie result. */
export type SessionLookup = (options: {
  headers: Headers;
  query: { disableCookieCache: true };
}) => Promise<{
  user?: { id?: unknown };
  session?: { userId?: unknown; expiresAt?: unknown };
} | null>;

export async function sessionIdentity(
  lookup: SessionLookup,
  headers: Headers,
  now = Date.now(),
): Promise<{ id: string } | null> {
  const result = await lookup({ headers, query: { disableCookieCache: true } });
  const id = result?.user?.id;
  const rawExpiry = result?.session?.expiresAt;
  const expiry =
    rawExpiry instanceof Date
      ? rawExpiry.getTime()
      : typeof rawExpiry === "string"
        ? Date.parse(rawExpiry)
        : NaN;
  if (
    typeof id !== "string" ||
    !id ||
    result?.session?.userId !== id ||
    !Number.isFinite(expiry) ||
    expiry <= now
  )
    return null;
  return { id };
}
