import { evaluateLiveGate } from "./security.ts";
import { localProbes } from "./reliability.ts";

type Env = Record<string, string | undefined>;

export type Severity = "critical" | "high" | "medium" | "low";
export type CheckStatus = "pass" | "gap" | "missing" | "claimed";

export interface ChecklistItem {
  area: string;
  id: string;
  status: CheckStatus;
  detail: string;
}

export interface Risk {
  id: string;
  severity: Severity;
  owner: "chủ repo";
  status: "open";
  mitigation: string;
  closeWhen: string;
}

export interface ReadinessReport {
  decision: "NO-GO";
  technicalScore: number;
  ownerMissing: string[];
  ownerClaimed: string[];
  productionDeployed: false;
  network: false;
  telemetry: false;
  estimatedUsd: 0;
  checks: ChecklistItem[];
  risks: Risk[];
  probes: ReturnType<typeof localProbes>;
}

export interface ReadinessSummary {
  decision: "NO-GO";
  technicalScore: number;
  ownerMissing: number;
  network: false;
  productionDeployed: false;
}

const OWNER_GATES: ReadonlyArray<{ id: string; env: string; closeWhen: string; severity: Severity }> = [
  {
    id: "staging-environment",
    env: "LUNA_STAGING_CONFIRMED",
    severity: "critical",
    closeWhen: "Chủ repo xác nhận môi trường staging ngoài repo. Cờ này không mở mạng.",
  },
  {
    id: "credential-owner",
    env: "LUNA_CREDENTIAL_OWNER_CONFIRMED",
    severity: "critical",
    closeWhen: "Có người giữ credential ngoài git. Không commit key.",
  },
  {
    id: "budget",
    env: "LUNA_BUDGET_CONFIRMED",
    severity: "high",
    closeWhen: "Chủ repo chốt ngân sách Firebase, 9Router và browser.",
  },
  {
    id: "security-approval",
    env: "LUNA_SECURITY_APPROVAL",
    severity: "high",
    closeWhen: "Có phê duyệt an ninh riêng cho production.",
  },
  {
    id: "rollback-owner",
    env: "LUNA_ROLLBACK_CONFIRMED",
    severity: "high",
    closeWhen: "Chủ repo chấp nhận rollback local-no-op trước khi có hosting.",
  },
  {
    id: "browser-policy",
    env: "LUNA_BROWSER_POLICY_CONFIRMED",
    severity: "high",
    closeWhen: "Có chính sách duyệt thao tác browser thật.",
  },
  {
    id: "zalo-eoffice-policy",
    env: "LUNA_ZALO_POLICY_CONFIRMED",
    severity: "high",
    closeWhen: "Có quyết định sản phẩm cho Zalo và eOffice.",
  },
];

export const DATA_SAFETY = {
  schemaVersion: 1 as const,
  migration: "additive-only" as const,
  backup: "in-process" as const,
  restore: "in-process" as const,
  retention: "process-lifetime" as const,
  realDataAccess: false as const,
};

export const COST_CONTROLS = [
  { service: "firebase", enabled: false as const, estimatedUsd: 0 as const },
  { service: "nine-router", enabled: false as const, estimatedUsd: 0 as const },
  { service: "browser", enabled: false as const, estimatedUsd: 0 as const },
] as const;

export function assessReadiness(input: { env?: Env } = {}): ReadinessReport {
  const env = input.env ?? {};
  const gate = evaluateLiveGate(env);
  const checks: ChecklistItem[] = [
    { area: "application", id: "local-control-plane", status: "pass", detail: "Control plane chạy local, dry-run." },
    {
      area: "security",
      id: "phase-lock",
      status: "pass",
      detail: "Phase lock không tắt từ UI hay API.",
    },
    {
      area: "security",
      id: "firebase-live",
      status: gate.violations.includes("firebase-live") ? "gap" : "pass",
      detail: "Firebase live giữ false. Không mở socket.",
    },
    {
      area: "security",
      id: "nine-router-live",
      status: gate.violations.includes("nine-router-live") ? "gap" : "pass",
      detail: "9Router live giữ false. Chi phí $0.",
    },
    {
      area: "security",
      id: "browser-launch",
      status: gate.violations.includes("browser-launch") ? "gap" : "pass",
      detail: "Browser liveLaunch giữ false.",
    },
    {
      area: "security",
      id: "production-lock",
      status: "pass",
      detail: "Production deploy luôn khóa trong phase này.",
    },
    {
      area: "access",
      id: "approval-audit",
      status: "pass",
      detail: "Approval, audit và dry-run không bị bypass.",
    },
    {
      area: "data",
      id: "schema-v1",
      status: "pass",
      detail: "Schema v1, migration additive, không đụng dữ liệu thật.",
    },
    {
      area: "observability",
      id: "local-logs",
      status: "pass",
      detail: "Log local có correlation id và redaction. Không gửi telemetry.",
    },
    {
      area: "reliability",
      id: "offline-controls",
      status: "pass",
      detail: "Timeout, retry, idempotency, circuit breaker và shutdown chỉ chạy offline.",
    },
    {
      area: "cost",
      id: "zero-cost",
      status: "pass",
      detail: "Firebase, 9Router và browser đều tắt. Ước tính $0.",
    },
    {
      area: "rollback",
      id: "local-no-op",
      status: "pass",
      detail: "Rollback không gọi hosting.",
    },
    {
      area: "incident",
      id: "local-procedure",
      status: "pass",
      detail: "Sự cố được ghi local. Không có đường gọi production.",
    },
  ];

  const ownerMissing: string[] = [];
  const ownerClaimed: string[] = [];
  for (const item of OWNER_GATES) {
    const claimed = env[item.env] === "true";
    checks.push({
      area: "owner",
      id: item.id,
      status: claimed ? "claimed" : "missing",
      detail: claimed
        ? "Đã thấy cờ xác nhận. Phase 7 vẫn không deploy."
        : "Thiếu xác nhận của chủ repo.",
    });
    if (claimed) ownerClaimed.push(item.id);
    else ownerMissing.push(item.id);
  }

  const technical = checks.filter((item) => item.area !== "owner");
  const passed = technical.filter((item) => item.status === "pass").length;
  const technicalScore = Math.round((passed / technical.length) * 100);

  return {
    decision: "NO-GO",
    technicalScore,
    ownerMissing,
    ownerClaimed,
    productionDeployed: false,
    network: false,
    telemetry: false,
    estimatedUsd: 0,
    checks,
    risks: riskRegister(),
    probes: localProbes(),
  };
}

export function riskRegister(): Risk[] {
  return [
    {
      id: "owner-collision",
      severity: "critical",
      owner: "chủ repo",
      status: "open",
      mitigation: "Mọi vai đang là cùng một handle. Không tính separation-of-duties. Không suy diễn handle khác.",
      closeWhen: "Bảy vai có handle khác nhau. Cùng một người không đủ.",
    },
    {
      id: "no-staging",
      severity: "critical",
      owner: "chủ repo",
      status: "open",
      mitigation: "Chủ repo báo staging đã có nhưng chưa xác minh. Không probe, không lưu URL. Staging owner vẫn trùng requester.",
      closeWhen: "Có evidence an toàn và staging owner khác requester. Báo cáo chưa verified không đủ.",
    },
    {
      id: "no-credential-owner",
      severity: "critical",
      owner: "chủ repo",
      status: "open",
      mitigation: "Handle credential trùng requester. Không tạo hay commit credential.",
      closeWhen: "Có handle credential khác requester, ngoài repository.",
    },
    {
      id: "no-budget",
      severity: "high",
      owner: "chủ repo",
      status: "open",
      mitigation: "Cap tháng đã ghi: Firebase 0 USD, 9Router 1 USD, Browser 1 USD. Lần này chi 0. Vượt cap thì từ chối. Không bật live.",
      closeWhen: "Có bằng chứng ngân sách còn hạn. Cap một mình không đóng rủi ro và không phải cờ xác nhận.",
    },
    {
      id: "no-security-approval",
      severity: "high",
      owner: "chủ repo",
      status: "open",
      mitigation: "Giữ phase lock và rules deny-all, không deploy rules.",
      closeWhen: "Có phê duyệt an ninh cho production.",
    },
    {
      id: "no-product-policy",
      severity: "high",
      owner: "chủ repo",
      status: "open",
      mitigation: "Browser chỉ được xét ở staging và launch vẫn tắt. Production browser bị cấm. Zalo/eOffice đang scope-pending, thao tác thật khóa. Owner collision chưa giải.",
      closeWhen: "Staging đã verified, evidence browser hợp lệ, hết collision, approval gate đạt, và Zalo/eOffice có scope cụ thể được chủ repo phê duyệt.",
    },
    {
      id: "memory-only-data",
      severity: "medium",
      owner: "chủ repo",
      status: "open",
      mitigation: "Backup chỉ là bản sao trong tiến trình. Không đọc dữ liệu thật.",
      closeWhen: "Có kế hoạch backup thật sau khi có credential và staging.",
    },
    {
      id: "preview-framing",
      severity: "low",
      owner: "chủ repo",
      status: "open",
      mitigation: "Không khoá iframe để preview còn chạy.",
      closeWhen: "Chủ repo quyết có khoá framing hay không.",
    },
  ];
}

export function summarizeReadiness(report: ReadinessReport): ReadinessSummary {
  return {
    decision: "NO-GO",
    technicalScore: report.technicalScore,
    ownerMissing: report.ownerMissing.length,
    network: false,
    productionDeployed: false,
  };
}
