import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  simulateDeliveryPdf,
  simulateEoffice,
  simulateExtract,
  simulateTicketEdit,
  simulateZalo,
} from "./handover.ts";

function assertOffline(result: { executed: boolean; networkCalls: number; login: boolean; live: boolean; storagePath: null }) {
  assert.equal(result.executed, false);
  assert.equal(result.networkCalls, 0);
  assert.equal(result.login, false);
  assert.equal(result.live, false);
  assert.equal(result.storagePath, null);
}

describe("handover policy simulation", () => {
  it("allows a simulated Zalo read only in a designated Bi group and never sends", () => {
    const read = simulateZalo({ action: "read", group: "designated-bi" });
    assert.equal(read.decision, "simulated");
    assert.equal(read.reason, "zalo-read-only");
    assertOffline(read);

    const send = simulateZalo({ action: "send", group: "designated-bi" });
    assert.equal(send.decision, "refused");
    assert.equal(send.reason, "zalo-send-forbidden");
    assertOffline(send);

    const other = simulateZalo({ action: "read", group: "other" });
    assert.equal(other.decision, "refused");
    assert.equal(other.reason, "zalo-group-not-designated");
  });

  it("reads or compares BM03.2 and refuses edit or submit", () => {
    for (const action of ["read", "compare"] as const) {
      const result = simulateEoffice({ form: "BM03.2", action });
      assert.equal(result.decision, "simulated");
      assert.equal(result.reason, "eoffice-read-compare");
      assertOffline(result);
    }
    for (const action of ["edit", "submit"] as const) {
      const result = simulateEoffice({ form: "BM03.2", action });
      assert.equal(result.decision, "refused");
      assert.equal(result.reason, "eoffice-mutate-forbidden");
      assertOffline(result);
    }
    assert.equal(simulateEoffice({ form: "other", action: "read" }).decision, "refused");
  });

  it("plans one PDF per delivery note and stops instead of inventing a path", () => {
    const merged = simulateDeliveryPdf({ deliveryNoteId: "note-mau", attachmentCount: 2 });
    assert.equal(merged.decision, "ask");
    assert.equal(merged.reason, "naming-rule-missing");
    assert.equal(merged.pdfPerNote, 1);
    assert.equal(merged.stored, false);
    assertOffline(merged);
    assert.equal(JSON.stringify(merged).includes("https://"), false);
    assert.equal(JSON.stringify(merged).includes("/"), false);

    const leaked = simulateDeliveryPdf({ deliveryNoteId: "https://files.example/token=abc", attachmentCount: 1 });
    assert.equal(leaked.decision, "ask");
    assert.equal(JSON.stringify(leaked).includes("files.example"), false);
    assert.equal(JSON.stringify(leaked).includes("token"), false);
  });

  it("extracts the handover fields and asks when one is unclear", () => {
    const complete = simulateExtract({
      deliveryDate: "2026-01-15",
      project: "du-an-mau",
      materials: "vat-tu-mau",
      lineItems: "hang-muc-mau",
      quantity: "1",
    });
    assert.equal(complete.decision, "simulated");
    assert.deepEqual(complete.fields, ["deliveryDate", "project", "materials", "lineItems", "quantity"]);
    assert.equal(JSON.stringify(complete).includes("du-an-mau"), false);
    assertOffline(complete);

    const unclear = simulateExtract({
      deliveryDate: "2026-01-15",
      project: "",
      materials: "vat-tu-mau",
      lineItems: "hang-muc-mau",
      quantity: "1",
    });
    assert.equal(unclear.decision, "ask");
    assert.equal(unclear.reason, "stop-and-ask-bi-or-luna");
    assert.deepEqual(unclear.fields, []);
  });

  it("lets only NV Trình phiếu edit a ticket after Bi approval, still offline", () => {
    const allowed = simulateTicketEdit({ actor: "nv-trinh-phieu", biApproved: true });
    assert.equal(allowed.decision, "simulated");
    assert.equal(allowed.reason, "ticket-edit-simulated");
    assertOffline(allowed);

    assert.equal(simulateTicketEdit({ actor: "nv-trinh-phieu", biApproved: false }).decision, "refused");
    assert.equal(simulateTicketEdit({ actor: "other", biApproved: true }).decision, "refused");
  });
});
