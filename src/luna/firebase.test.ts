import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadFirebasePublicConfig, LUNAZL_FIREBASE_DATABASE_URL } from "./config.ts";
import { LunaError, PhaseLockedError, sequenceIds } from "./domain.ts";
import {
  MemoryRealtimeDatabase,
  PhaseLockedFirebaseAdapter,
  createRealtimeDatabase,
} from "./firebase.ts";
import { evaluateFirebaseConnect } from "./firebase-rtdb.ts";
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

  it("parses the lunazl-agent URL and stays locked without opt-in, credential, or transport", async () => {
    const calls: string[] = [];
    const transport: RtdbTransport = {
      async request(input) {
        calls.push(input.url);
        return { status: 200, body: null };
      },
    };
    const quiet = loadFirebasePublicConfig({
      FIREBASE_PROJECT_ID: "lunazl-agent",
      FIREBASE_DATABASE_URL: `${LUNAZL_FIREBASE_DATABASE_URL}/`,
      FIREBASE_LIVE_ENABLED: "false",
    });
    assert.equal(quiet.databaseUrl, LUNAZL_FIREBASE_DATABASE_URL);
    assert.equal(
      quiet.databaseUrlHost,
      "lunazl-agent-default-rtdb.asia-southeast1.firebasedatabase.app",
    );
    assert.equal(quiet.liveRequested, false);
    assert.equal(quiet.liveEnabled, false);
    assert.equal(quiet.credentialConfigured, false);
    assert.equal(createRealtimeDatabase(quiet).mode, "memory");

    const optedIn = loadFirebasePublicConfig({
      FIREBASE_DATABASE_URL: LUNAZL_FIREBASE_DATABASE_URL,
      FIREBASE_LIVE_ENABLED: "true",
    });
    assert.equal(optedIn.liveEnabled, false);
    const missingCredential = evaluateFirebaseConnect(optedIn, { transport });
    assert.equal(missingCredential.ok, false);
    if (!missingCredential.ok) assert.equal(missingCredential.reason, "missing-credential");
    const locked = createRealtimeDatabase(optedIn, undefined, { transport });
    assert.equal(locked.mode, "disabled-live");
    await assert.rejects(() => locked.get("/luna/v1/settings"), PhaseLockedError);
    assert.equal(calls.length, 0);

    const withToken = createRealtimeDatabase(optedIn, undefined, {
      transport,
      authToken: "runtime-token",
    });
    assert.equal(withToken.mode, "rest");
    assert.equal(await withToken.get("/luna/v1/settings"), null);
    assert.equal(calls.length, 1);
    assert.match(
      calls[0] ?? "",
      /^https:\/\/lunazl-agent-default-rtdb\.asia-southeast1\.firebasedatabase\.app\/luna\/v1\/settings\.json\?auth=runtime-token$/,
    );
  });
});
