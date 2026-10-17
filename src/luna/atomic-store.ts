import { LunaError } from "./domain.ts";
import { LunaControlPlane, type PlaneCheckpoint } from "./control-plane.ts";

export interface WorkspaceDocument {
  version: 1;
  plane: PlaneCheckpoint;
  taskOwners: Record<string, string>;
}
export interface QueryPort {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}
export interface TransactionPort extends QueryPort {
  transaction<T>(work: (tx: QueryPort) => Promise<T>): Promise<T>;
}
export interface CommandReceipt {
  subject: string;
  fingerprint: string;
  result: unknown;
}

/** One reserved PostgreSQL connection/transaction; PGLite implements this port in tests. */
export class SqlWorkspaceStore {
  private readonly db: TransactionPort;
  constructor(db: TransactionPort) {
    this.db = db;
  }

  async read(workspace: string): Promise<WorkspaceDocument | null> {
    const result = await this.db.query<{ document: WorkspaceDocument }>(
      "SELECT document FROM luna_workspaces WHERE workspace_id=$1",
      [workspace],
    );
    return result.rows[0]?.document ?? null;
  }

  async command<T>(
    workspace: string,
    requestId: string,
    subject: string,
    fingerprint: string,
    authorize: () => void,
    work: (document: WorkspaceDocument) => Promise<{ document: WorkspaceDocument; result: T }>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const empty: WorkspaceDocument = {
        version: 1,
        plane: LunaControlPlane.createDefault({}).exportCheckpoint(),
        taskOwners: {},
      };
      await tx.query(
        "INSERT INTO luna_workspaces(workspace_id, document) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING",
        [workspace, JSON.stringify(empty)],
      );
      const row = (
        await tx.query<{ revision: string | number; document: WorkspaceDocument }>(
          "SELECT revision, document FROM luna_workspaces WHERE workspace_id=$1 FOR UPDATE",
          [workspace],
        )
      ).rows[0];
      if (!row) throw new LunaError("PERSISTENCE", "Workspace không khả dụng.");
      authorize();
      const prior = (
        await tx.query<CommandReceipt>(
          "SELECT subject, fingerprint, result FROM luna_command_receipts WHERE workspace_id=$1 AND request_id=$2",
          [workspace, requestId],
        )
      ).rows[0];
      if (prior) {
        if (prior.subject !== subject || prior.fingerprint !== fingerprint)
          throw new LunaError(
            "REPLAY_CONFLICT",
            "Request id đã được dùng cho nội dung hoặc principal khác.",
          );
        return prior.result as T;
      }
      const next = await work(structuredClone(row.document));
      authorize();
      const changed = await tx.query(
        "UPDATE luna_workspaces SET document=$1::jsonb, revision=revision+1 WHERE workspace_id=$2 AND revision=$3 RETURNING revision",
        [JSON.stringify(next.document), workspace, row.revision],
      );
      if (changed.rows.length !== 1) throw new LunaError("STALE_STATE", "Revision đã thay đổi.");
      await tx.query(
        "INSERT INTO luna_command_receipts(workspace_id, request_id, subject, fingerprint, result) VALUES ($1,$2,$3,$4,$5::jsonb)",
        [workspace, requestId, subject, fingerprint, JSON.stringify(next.result)],
      );
      return next.result;
    });
  }
}
