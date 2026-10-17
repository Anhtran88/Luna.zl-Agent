import { createFileRoute } from "@tanstack/react-router";
import { trustedAuthEnabled } from "@/luna/server/runtime.server";

async function handle({ request }: { request: Request }): Promise<Response> {
  if (!trustedAuthEnabled()) return Response.json({ code: "AUTH_DISABLED" }, { status: 503 });
  try {
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    assertSameSiteRequest();
    const { auth } = await import("@/lib/auth/server");
    return await auth.handler(request);
  } catch {
    return Response.json({ code: "AUTH_UNAVAILABLE" }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
