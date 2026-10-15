import { BROWSER_CONTRACTS, type BrowserBackendContract } from "./browser.ts";
import {
  LUNAZL_FIREBASE_DATABASE_URL,
  type FirebasePublicConfig,
  type NineRouterPublicConfig,
} from "./config.ts";
import { evaluateFirebaseConnect } from "./firebase-rtdb.ts";
import { evaluateNineRouterConnect, type NineRouterConnectDecision } from "./models.ts";

export type AdapterPosture = "memory" | "mock" | "locked" | "stub";

export interface Phase4AdapterContract {
  id: "firebase-rtdb" | "nine-router" | "playwright" | "skyvern" | "browser-use";
  posture: AdapterPosture;
  liveEnabled: false;
  network: false;
  credentialEnv: string | null;
}

/** Real adapter shapes. None of them open a socket or a browser in Phase 4. */
export const PHASE4_ADAPTERS: readonly Phase4AdapterContract[] = [
  {
    id: "firebase-rtdb",
    posture: "memory",
    liveEnabled: false,
    network: false,
    credentialEnv: "FIREBASE_SERVICE_ACCOUNT_JSON",
  },
  {
    id: "nine-router",
    posture: "mock",
    liveEnabled: false,
    network: false,
    credentialEnv: "NINE_ROUTER_API_KEY",
  },
  { id: "playwright", posture: "stub", liveEnabled: false, network: false, credentialEnv: null },
  { id: "skyvern", posture: "stub", liveEnabled: false, network: false, credentialEnv: null },
  { id: "browser-use", posture: "stub", liveEnabled: false, network: false, credentialEnv: null },
];

export function browserContractsLocked(): readonly BrowserBackendContract[] {
  return BROWSER_CONTRACTS.filter((contract) => contract.liveLaunch === false && contract.dryRunOnly);
}

export function firebaseStaysOffline(config: FirebasePublicConfig): boolean {
  const decision = evaluateFirebaseConnect(config);
  return decision.ok === false && config.liveEnabled === false && config.databaseUrl !== "";
}

export function nineRouterStaysOffline(config: NineRouterPublicConfig): NineRouterConnectDecision {
  return evaluateNineRouterConnect(config);
}

export const PHASE4_FIREBASE_URL = LUNAZL_FIREBASE_DATABASE_URL;
