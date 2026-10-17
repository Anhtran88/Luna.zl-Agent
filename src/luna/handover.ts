/** Simulated handover policy. No login, no network, no file write. Storage root stays outside the repo. */

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
  if (input.action !== "read") return { ...LOCKED, decision: "refused", reason: "zalo-send-forbidden" };
  if (input.group !== "designated-bi") return { ...LOCKED, decision: "refused", reason: "zalo-group-not-designated" };
  return { ...LOCKED, decision: "simulated", reason: "zalo-read-only" };
}

export function simulateEoffice(input: {
  form: "BM03.2" | "other";
  action: "read" | "compare" | "edit" | "submit";
}): HandoverResult {
  if (input.form !== "BM03.2") return { ...LOCKED, decision: "refused", reason: "eoffice-form-not-approved" };
  if (input.action !== "read" && input.action !== "compare") {
    return { ...LOCKED, decision: "refused", reason: "eoffice-mutate-forbidden" };
  }
  return { ...LOCKED, decision: "simulated", reason: "eoffice-read-compare" };
}

export const DELIVERY_PDF_PATTERN = "P.GIAO_[VATTU]_[dd.mm.yyyy]_[DUAN].pdf";
export const HANDOVER_STORAGE_ROOT_ENV = "LUNA_HANDOVER_STORAGE_ROOT";

/** Confirmed project codes. Any other code asks. A caller map may only point at these. */
export const CONFIRMED_PROJECT_ALIASES = ["SUN", "HOL", "GRC"] as const;

/** Display-name map stays empty in git. Supply it outside the repo if needed. */
export const PROJECT_ALIASES: Readonly<Record<string, string>> = {};

export interface DeliveryPdfPlan extends HandoverResult {
  pdfPerNote: 0 | 1;
  stored: false;
  fileName: string | null;
  relativeLabels: string[] | null;
  storageRootConfigured: boolean;
}

export function readHandoverStorageRoot(env: Record<string, string | undefined> = {}): string | null {
  const value = env[HANDOVER_STORAGE_ROOT_ENV]?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function materialToken(value: string | null | undefined): string | null {
  const ascii = (value ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d");
  const token = ascii.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return token.length >= 2 && token.length <= 24 ? token : null;
}

function formatDeliveryDate(value: string | null | undefined): { label: string; year: string; month: string } | null {
  const text = value?.trim() ?? "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dmy = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (!iso && !dmy) return null;
  const year = Number(iso ? iso[1] : dmy?.[3]);
  const month = Number(iso ? iso[2] : dmy?.[2]);
  const day = Number(iso ? iso[3] : dmy?.[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return { label: `${dd}.${mm}.${year}`, year: String(year), month: mm };
}

function confirmedAlias(value: string | null | undefined): string | null {
  const token = value?.trim().toUpperCase() ?? "";
  return (CONFIRMED_PROJECT_ALIASES as readonly string[]).includes(token) ? token : null;
}

function resolveProjectAlias(input: {
  project?: string | null;
  projectAlias?: string | null;
  aliases?: Readonly<Record<string, string>>;
}): string | null {
  if (input.projectAlias?.trim()) return confirmedAlias(input.projectAlias);
  const project = input.project?.trim() ?? "";
  if (!project) return null;
  const table = input.aliases ?? PROJECT_ALIASES;
  const key = Object.hasOwn(table, project) ? project : project.toLowerCase();
  const mapped = Object.hasOwn(table, key) ? table[key] : undefined;
  if (mapped !== undefined) return confirmedAlias(mapped);
  return confirmedAlias(project);
}

function withDuplicateSuffix(fileName: string, existing: readonly string[]): string | null {
  if (!existing.includes(fileName)) return fileName;
  const stem = fileName.slice(0, -".pdf".length);
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${stem}_${String(index).padStart(2, "0")}.pdf`;
    if (!existing.includes(candidate)) return candidate;
  }
  return null;
}

export function planDeliveryPdf(input: {
  deliveryDate?: string | null;
  material?: string | null;
  project?: string | null;
  projectAlias?: string | null;
  aliases?: Readonly<Record<string, string>>;
  formCode?: "BM03.2" | null;
  attachmentCount: number;
  existingNames?: readonly string[];
  storageRoot?: string | null;
}): DeliveryPdfPlan {
  const locked = {
    ...LOCKED,
    stored: false as const,
    fileName: null,
    relativeLabels: null,
    storageRootConfigured: Boolean(input.storageRoot?.trim()),
    pdfPerNote: 0 as const,
  };
  const raw = [input.deliveryDate, input.material, input.project, input.projectAlias]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  if (looksUnsafe(raw) || !materialToken(input.material) || !formatDeliveryDate(input.deliveryDate) ||
      !Number.isSafeInteger(input.attachmentCount) || input.attachmentCount < 1) {
    return { ...locked, decision: "ask", reason: "missing-field" };
  }
  const material = materialToken(input.material);
  const date = formatDeliveryDate(input.deliveryDate);
  if (!material || !date) return { ...locked, decision: "ask", reason: "missing-field" };
  const alias = resolveProjectAlias(input);
  if (!alias) return { ...locked, decision: "ask", reason: "unknown-project-alias" };
  const form = input.formCode === "BM03.2" ? "_BM03.2" : "";
  const base = `P.GIAO_${material}_${date.label}_${alias}${form}.pdf`;
  const fileName = withDuplicateSuffix(base, input.existingNames ?? []);
  if (!fileName) return { ...locked, decision: "ask", reason: "duplicate-limit" };
  return {
    ...locked,
    decision: "simulated",
    reason: "named",
    pdfPerNote: 1,
    fileName,
    relativeLabels: [date.year, date.month, material],
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
