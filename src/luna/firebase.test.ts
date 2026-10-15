import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadFirebasePublicConfig } from "./config.ts";
import { LunaError, PhaseLockedError, sequenceIds } from "./domain.ts";
import {
  MemoryRealtimeDatabase,
  PhaseLockedFirebaseAdapter,
  createRealtimeDatabase,
} from "./firebase.ts";
import type { RtdbTransport } from "./firebase-rtdb.ts";

describe("firebase realtime port", () => {
  it("stores JSON in memory and rejects unsafe paths", async () => {
    const db = new MemoryRealtimeDatabase({ "/luna/queue": { items: [] } }, sequenceIds());
    assert.deepEqual(await db.get("/luna/queue"), { items: [] });

    const id = await db.push("/luna/queue", { name: "a" });
    assert.equal(id, "node_1");
    assert.deepEqual(await db.get(`/luna/queue/${id}`), { name: "a" });

    await db.update("/luna/queue", { items: ["a"] });
    assert.deepEqual(await db.get("/luna/queue"), { items: ["a"] });

    let seen: unknown;
    const stop = db.listen("/luna/queue", (value) => {
      seen = value;
    });
    assert.deepEqual(seen, { items: ["a"] });
    await db.remove("/luna/queue");
    assert.equal(await db.get("/luna/queue"), null);
    assert.equal(await db.get(`/luna/queue/${id}`), null);
    assert.equal(seen, null);
    stop();

    const childId = await db.push("/luna/queue", { name: "child" });
    let child: unknown = "unset";
    db.listen(`/luna/queue/${childId}`, (value) => {
      child = value;
    });
    assert.deepEqual(child, { name: "child" });
    await db.remove("/luna/queue");
    assert.equal(child, null);

    await assert.rejects(
      () => db.get("/luna/../secret"),
      (error: unknown) => error instanceof LunaError && error.code === "PATH",
    );
    await assert.rejects(
      () => db.set("/luna/queue", undefined),
      (error: unknown) => error instanceof LunaError && error.code === "DATA",
    );
  });

  it("does not open a live client when live is requested", async () => {
    const config = loadFirebasePublicConfig({ LUNA_FIREBASE_LIVE: "true" });
    const db = createRealtimeDatabase(config, { "/luna/queue": { items: ["nope"] } });
    assert.equal(db.mode, "disabled-live");
    await assert.rejects(() => db.get("/luna/queue"), PhaseLockedError);
    await assert.rejects(() => db.set("/luna/queue", { items: [] }), PhaseLockedError);
    assert.throws(() => db.listen("/luna/queue", () => undefined), PhaseLockedError);
  });

  it("phase-locked adapter never returns data", async () => {
    const db = new PhaseLockedFirebaseAdapter();
    await assert.rejects(() => db.push("/luna/queue", { a: 1 }), PhaseLockedError);
    await assert.rejects(() => db.update("/luna/queue", { a: 1 }), PhaseLockedError);
    await assert.rejects(() => db.remove("/luna/queue"), PhaseLockedError);
  });

  it("uses the REST client only with an explicit transport and redacts the token", async () => {
    const calls: string[] = [];
    const token = "test-token-value";
    const transport: RtdbTransport = {
      async request(input) {
        calls.push(input.url);
        if (input.method === "GET") return { status: 401, body: { error: token } };
        return { status: 200, body: { name: "node_x" } };
      },
    };
    const config = loadFirebasePublicConfig({
      FIREBASE_DATABASE_URL: "https://luna-dev.firebasedatabase.app/ignored",
      LUNA_FIREBASE_LIVE: "true",
    });
    const blocked = createRealtimeDatabase(config, undefined, {
      transport,
      authToken: "{\"private_key\":\"nope\"}",
    });
    assert.equal(blocked.mode, "disabled-live");
    assert.equal(calls.length, 0);

    const client = createRealtimeDatabase(config, undefined, { transport, authToken: token });
    assert.equal(client.mode, "rest");
    await assert.rejects(
      () => client.get("/luna/queue"),
      (error: unknown) =>
        error instanceof LunaError && error.code === "NETWORK" && !error.message.includes(token),
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0] ?? "", /https:\/\/luna-dev\.firebasedatabase\.app\/luna\/queue\.json\?auth=/);
    assert.equal(config.databaseUrl, "https://luna-dev.firebasedatabase.app");
  });
});
