import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { authEnabled, GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { getAuthStatusFn } from "@/luna/server/functions";
import { UserButton } from "@/lib/auth/gates";

export const Route = createFileRoute("/login")({
  loader: () => getAuthStatusFn(),
  component: Login,
});

function Login() {
  const { configured } = Route.useLoaderData();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto min-h-screen max-w-lg px-6 py-16 text-fg">
      <h1 className="font-display text-3xl">Đăng nhập Luna</h1>
      {configured && authEnabled ? (
        <div className="mt-4">
          <UserButton />
        </div>
      ) : null}
      <p className="mt-4 text-muted">
        Đăng nhập không tự cấp quyền duyệt, thực thi hoặc bật tích hợp thật. Luna vẫn NO-GO.
      </p>
      {configured && authEnabled ? (
        <div className="mt-6 flex flex-col gap-3">
          {GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              disabled={busy}
              className="min-h-11 rounded-xl border border-line px-4 disabled:opacity-50"
              onClick={() => {
                setBusy(true);
                setError("");
                void signIn(provider.providerId, {
                  callbackURL: "/",
                  errorCallbackURL: "/login",
                }).catch(() => {
                  setError("Không hoàn tất được đăng nhập. Thử lại hoặc liên hệ chủ môi trường.");
                  setBusy(false);
                });
              }}
            >
              Tiếp tục với {provider.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-6 rounded-xl border border-line p-4">
          Đăng nhập chưa được chủ môi trường cấu hình. Không dùng tài khoản demo để cấp quyền.
        </p>
      )}
      <p className="mt-4 text-sm text-muted" role="status">
        {error}
      </p>
      <a className="mt-6 inline-block underline" href="/">
        Quay lại Luna
      </a>
    </main>
  );
}
