/** Simulated handover policy. No login, no network, no filesystem path. */

export const EXTRACT_FIELDS = ["deliveryDate", "project", "materials", "lineItems", "quantity"] as const;
export type ExtractField = (typeof EXTRACT_FIELDS)[number];

export interface HandoverResult {
  decision: "simulated" | "refused" | "ask";
  executed: false;
  networkCalls: 0;
  login: false;
  live: false;
  storagePath: null;
  reason: string;
}

const LOCKED = {
  executed: false as const,
  networkCalls: 0 as const,
  login: false as const,
  live: false as const,
  storagePath: null,
};

function looksUnsafe(value: string): boolean {
  return /https?:\/\//i.test(value) || /[\\/~@]/.test(value) || /token|secret|password|cookie|credential/i.test(value);
}

export function simulateZalo(input: { action: "read" | "send"; group: "designated-bi" | "other" }): HandoverResult {
  if (input.action === "send") return { ...LOCKED, decision: "refused", reason: "zalo-send-forbidden" };
  if (input.group !== "designated-bi") return { ...LOCKED, decision: "refused", reason: "zalo-group-not-designated" };
  return { ...LOCKED, decision: "simulated", reason: "zalo-read-only" };
}

export function simulateEoffice(input: {
  form: "BM03.2" | "other";
  action: "read" | "compare" | "edit" | "submit";
}): HandoverResult {
  if (input.form !== "BM03.2") return { ...LOCKED, decision: "refused", reason: "eoffice-form-not-approved" };
  if (input.action === "edit" || input.action === "submit") {
    return { ...LOCKED, decision: "refused", reason: "eoffice-mutate-forbidden" };
  }
  return { ...LOCKED, decision: "simulated", reason: "eoffice-read-compare" };
}

export function simulateDeliveryPdf(input: { deliveryNoteId: string; attachmentCount: number }): HandoverResult & {
  pdfPerNote: 1 | 0;
  stored: false;
} {
  if (!input.deliveryNoteId.trim() || looksUnsafe(input.deliveryNoteId) || input.attachmentCount < 1) {
    return { ...LOCKED, decision: "ask", reason: "delivery-note-unclear", pdfPerNote: 0, stored: false };
  }
  return {
    ...LOCKED,
    decision: "ask",
    reason: "naming-rule-missing",
    pdfPerNote: 1,
    stored: false,
  };
}

export function simulateExtract(fields: Partial<Record<ExtractField, string>>): HandoverResult & {
  fields: ExtractField[];
} {
  const missing = EXTRACT_FIELDS.filter((field) => {
    const value = fields[field]?.trim() ?? "";
    return value.length === 0 || looksUnsafe(value);
  });
  if (missing.length > 0) {
    return { ...LOCKED, decision: "ask", reason: "stop-and-ask-bi-or-luna", fields: [] };
  }
  return { ...LOCKED, decision: "simulated", reason: "fields-recorded", fields: [...EXTRACT_FIELDS] };
}

export function simulateTicketEdit(input: { actor: "nv-trinh-phieu" | "other"; biApproved: boolean }): HandoverResult {
  if (input.actor !== "nv-trinh-phieu" || input.biApproved !== true) {
    return { ...LOCKED, decision: "refused", reason: "ticket-edit-forbidden" };
  }
  return { ...LOCKED, decision: "simulated", reason: "ticket-edit-simulated" };
}
