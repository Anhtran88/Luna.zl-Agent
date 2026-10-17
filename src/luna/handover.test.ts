import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DELIVERY_PDF_PATTERN,
  planDeliveryPdf,
  PROJECT_ALIASES,
  readHandoverStorageRoot,
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

const NAMED = {
  deliveryDate: "2026-01-15",
  material: "Thép",
  projectAlias: "DUANMAU",
  attachmentCount: 2,
} as const;

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

  it("names one merged PDF when the fields are known and does not write it", () => {
    assert.equal(DELIVERY_PDF_PATTERN, "P.GIAO_[VATTU]_[dd.mm.yyyy]_[DUAN].pdf");
    assert.deepEqual(PROJECT_ALIASES, {});
    assert.equal(readHandoverStorageRoot(), null);
    assert.equal(readHandoverStorageRoot({ LUNA_HANDOVER_STORAGE_ROOT: "  " }), null);

    const merged = planDeliveryPdf(NAMED);
    assert.equal(merged.decision, "simulated");
    assert.equal(merged.reason, "named");
    assert.notEqual(merged.reason, "naming-rule-missing");
    assert.equal(merged.fileName, "P.GIAO_THEP_15.01.2026_DUANMAU.pdf");
    assert.equal(merged.pdfPerNote, 1);
    assert.equal(merged.stored, false);
    assert.equal(merged.storageRootConfigured, false);
    assert.deepEqual(merged.relativeLabels, ["2026", "01", "THEP"]);
    assertOffline(merged);

    const dotted = planDeliveryPdf({ ...NAMED, deliveryDate: "15.01.2026", material: "VATTU", projectAlias: "DUAN" });
    assert.equal(dotted.fileName, "P.GIAO_VATTU_15.01.2026_DUAN.pdf");
    assert.equal(dotted.pdfPerNote, 1);
  });

  it("adds _02 and _03 on a name collision and can include BM03.2", () => {
    const base = "P.GIAO_THEP_15.01.2026_DUANMAU.pdf";
    const second = planDeliveryPdf({ ...NAMED, existingNames: [base] });
    assert.equal(second.fileName, "P.GIAO_THEP_15.01.2026_DUANMAU_02.pdf");
    assert.equal(second.stored, false);
    assertOffline(second);

    const third = planDeliveryPdf({ ...NAMED, existingNames: [base, second.fileName ?? ""] });
    assert.equal(third.fileName, "P.GIAO_THEP_15.01.2026_DUANMAU_03.pdf");

    const withForm = planDeliveryPdf({ ...NAMED, formCode: "BM03.2" });
    assert.equal(withForm.fileName, "P.GIAO_THEP_15.01.2026_DUANMAU_BM03.2.pdf");
    const withFormDup = planDeliveryPdf({
      ...NAMED,
      formCode: "BM03.2",
      existingNames: [withForm.fileName ?? ""],
    });
    assert.equal(withFormDup.fileName, "P.GIAO_THEP_15.01.2026_DUANMAU_BM03.2_02.pdf");
    assert.equal(withFormDup.pdfPerNote, 1);
    assert.equal(withFormDup.stored, false);
  });

  it("asks when a field is missing or the project alias is unknown", () => {
    const missing = planDeliveryPdf({ material: "Thép", projectAlias: "DUANMAU", attachmentCount: 1 });
    assert.equal(missing.decision, "ask");
    assert.equal(missing.reason, "missing-field");
    assert.equal(missing.fileName, null);
    assert.equal(missing.pdfPerNote, 0);
    assert.equal(missing.stored, false);
    assertOffline(missing);

    const badDate = planDeliveryPdf({ ...NAMED, deliveryDate: "31.02.2026" });
    assert.equal(badDate.reason, "missing-field");
    assert.equal(badDate.fileName, null);

    const noFile = planDeliveryPdf({ ...NAMED, attachmentCount: 0 });
    assert.equal(noFile.reason, "missing-field");

    const unknown = planDeliveryPdf({
      deliveryDate: "2026-01-15",
      material: "Thép",
      project: "cong trinh mau",
      attachmentCount: 1,
    });
    assert.equal(unknown.decision, "ask");
    assert.equal(unknown.reason, "unknown-project-alias");
    assert.equal(unknown.fileName, null);
    const unknownBody = JSON.stringify(unknown);
    assert.equal(unknownBody.includes("cong trinh"), false);
    assert.equal(unknownBody.includes("CONGTRINH"), false);

    const lower = planDeliveryPdf({ ...NAMED, projectAlias: undefined, project: "duanmau" });
    assert.equal(lower.reason, "unknown-project-alias");
    assert.equal(lower.fileName, null);

    const mapped = planDeliveryPdf({
      deliveryDate: "2026-01-15",
      material: "Thép",
      project: "du an mau",
      aliases: { "du an mau": "DUANMAU" },
      attachmentCount: 1,
    });
    assert.equal(mapped.fileName, "P.GIAO_THEP_15.01.2026_DUANMAU.pdf");
    assert.equal(JSON.stringify(mapped).includes("du an mau"), false);

    const notInTable = planDeliveryPdf({
      ...NAMED,
      projectAlias: "OTHER",
      aliases: { "du an mau": "DUANMAU" },
    });
    assert.equal(notInTable.reason, "unknown-project-alias");
    assert.equal(notInTable.fileName, null);
  });

  it("does not leak a storage root, a URL, or a write", () => {
    const root = "ROOT_SHOULD_NOT_LEAK";
    const named = planDeliveryPdf({ ...NAMED, storageRoot: root });
    assert.equal(named.storageRootConfigured, true);
    assert.equal(named.stored, false);
    assert.equal(named.fileName, "P.GIAO_THEP_15.01.2026_DUANMAU.pdf");
    const body = JSON.stringify(named);
    assert.equal(body.includes(root), false);
    assert.equal(body.includes("/"), false);
    assert.equal(body.includes("\\"), false);
    assert.equal(body.includes("OneDrive"), false);
    assert.equal(readHandoverStorageRoot({ LUNA_HANDOVER_STORAGE_ROOT: root }), root);
    assert.equal(JSON.stringify(planDeliveryPdf({ ...NAMED, storageRoot: readHandoverStorageRoot({ LUNA_HANDOVER_STORAGE_ROOT: root }) })).includes(root), false);

    const leaked = planDeliveryPdf({
      ...NAMED,
      project: "https://files.example/token=abc",
    });
    assert.equal(leaked.decision, "ask");
    assert.equal(leaked.fileName, null);
    const leakedBody = JSON.stringify(leaked);
    assert.equal(leakedBody.includes("files.example"), false);
    assert.equal(leakedBody.includes("token"), false);
    assert.equal(leakedBody.includes("https://"), false);

    const source = readFileSync("src/luna/handover.ts", "utf8");
    assert.equal(source.includes("OneDrive"), false);
    assert.equal(source.includes("writeFile"), false);
    assert.equal(source.includes("node:fs"), false);
    assert.equal(source.includes("naming-rule-missing"), false);
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
