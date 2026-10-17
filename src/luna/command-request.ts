/** Browser-only retry metadata: retain opaque id + payload digest, never token or task contents. */
export async function reliableCommand<T>(
  scope: string,
  payload: unknown,
  send: (requestId: string) => Promise<T>,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = window.sessionStorage,
): Promise<T> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const key = `luna-pending:${scope}:${fingerprint}`;
  const requestId = storage.getItem(key) ?? crypto.randomUUID();
  storage.setItem(key, requestId);
  // Only a committed command ACK is definitive. Re-auth/config errors after a lost ACK
  // do not prove that the original operation was absent; keep its id for recovery.
  const result = await send(requestId);
  const response =
    result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  if (
    !response ||
    response.acknowledged === true ||
    response.ok === true ||
    response.code === "REPLAY_CONFLICT"
  )
    storage.removeItem(key);
  return result;
}
