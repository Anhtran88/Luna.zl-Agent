import { SECURITY_HEADERS } from "../../src/luna/security-headers.ts";

export default async function lunaSecurityHeaders(
  _event: unknown,
  next: () => Promise<unknown> | unknown,
) {
  const result = await next();
  if (result instanceof Response) {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (!result.headers.has(key)) result.headers.set(key, value);
    }
  }
  return result;
}
