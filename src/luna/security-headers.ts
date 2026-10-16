/**
 * Preview-safe headers. No X-Frame-Options and no frame-ancestors, because the
 * control plane is embedded. No script-src, because the dev server and fonts
 * would break.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-DNS-Prefetch-Control": "off",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": "base-uri 'self'; object-src 'none'",
};

export const SESSION_COOKIE_POSTURE = {
  lunaSetsCookie: false,
  templatePrefix: "__Host-",
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  logsCookieValue: false,
} as const;
