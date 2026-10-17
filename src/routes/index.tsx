import { createFileRoute } from "@tanstack/react-router";
import { LunaDesk } from "@/components/luna/desk";
import { getSnapshotFn } from "@/luna/server/functions";

export const Route = createFileRoute("/")({
  loader: () => getSnapshotFn(),
  component: Home,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-lg px-6 py-16 text-fg">
      <h1 className="font-display text-3xl">Chưa mở được Luna</h1>
      <p className="mt-4 text-muted">
        {error instanceof Error ? error.message : "Không xác minh hoặc đọc được workspace."}
      </p>
      <p className="mt-4 text-muted">Không dùng dữ liệu demo thay cho workspace cần xác thực.</p>
      <a href="/login" className="mt-6 inline-block underline">
        Đăng nhập / tài khoản
      </a>
    </main>
  ),
});

function Home() {
  const snapshot = Route.useLoaderData();
  return <LunaDesk snapshot={snapshot} />;
}
