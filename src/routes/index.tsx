import { createFileRoute } from "@tanstack/react-router";
import { LunaDesk } from "@/components/luna/desk";
import { getSnapshotFn } from "@/luna/server/functions";

export const Route = createFileRoute("/")({
  loader: () => getSnapshotFn(),
  component: Home,
});

function Home() {
  const snapshot = Route.useLoaderData();
  return <LunaDesk snapshot={snapshot} />;
}
