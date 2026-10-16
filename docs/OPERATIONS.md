# Vận hành Phase 12

Phase 12 kiểm operational readiness và continuous compliance ở máy local. Production vẫn **NO-GO**. Quyền deploy **not-granted**. Phase này không chấp nhận cờ `*_CONFIRMED=true` làm sign-off.

```bash
npm run ops:check
npm run governance:check
npm run validate:sim
npm run production:check
npm run security:check
```

`ops:check` không gọi mạng. Báo cáo có evidence score, blocker id, compliance, assignee chủ repo đã cung cấp, và sáu diễn tập. Không in secret, token, cookie, private key, credential hay URL.

## Checklist

Bảy vai đã được chủ repo gán cho **kenbi**, nhưng đó là **owner collision**. Separation-of-duties giữ **BLOCKED**. Không suy diễn thành bảy handle khác nhau. Approver, security reviewer và credential owner trùng requester nên governance, staging và production vẫn NO-GO.

Ngân sách: cap tháng đã ghi và **không phải quyền chi**. Firebase tối đa **0 USD**, 9Router tối đa **1 USD**, Browser tối đa **1 USD**. Lần này không phát sinh phí. Vượt cap thì từ chối và không gọi dịch vụ. Bằng chứng ngân sách vẫn BLOCKED.

| Dịch vụ | Cap tối đa / tháng | Tiền tệ | Trạng thái |
| --- | --- | --- | --- |
| Firebase | 0 | USD | cap đã ghi, evidence BLOCKED |
| 9Router | 1 | USD | cap đã ghi, evidence BLOCKED |
| Browser | 1 | USD | cap đã ghi, evidence BLOCKED |

Staging: chủ repo báo **đã có** (`owner-reported-present`) nhưng `verified=false`. Không probe, không lưu URL hay credential. Staging owner vẫn là kenbi nên chưa độc lập.

Browser automation: policy **chỉ staging**, cap 1 USD/tháng. Launch **tắt** cho tới khi staging được xác minh, evidence browser hợp lệ, hết owner collision và approval gate đạt. Production browser **cấm**. Playwright, Skyvern và Browser Use giữ stub.

Zalo/eOffice: `authorization=scope-pending`. Chưa có scope hay action. Mọi thao tác thật vẫn khóa. Không suy diễn, không đăng nhập, không gửi hay ghi dữ liệu.

License package: **MIT**. Copyright trong `LICENSE` dùng GitHub login `Anhtran88` vì profile không có tên pháp lý. Chủ repo thay nếu muốn tên khác. License không chuyển GO.

Quyết định ghi ở [config/readiness/owner-decisions.json](../config/readiness/owner-decisions.json). Evidence vẫn BLOCKED khi thiếu digest, hạn hoặc approval reference.

Mẫu trống, không có dữ liệu thật, nằm ở [config/readiness](../config/readiness):

| Mẫu | Chủ repo điền ngoài repo |
| --- | --- |
| `role-assignment.template.json` | Mọi vai là kenbi và BLOCKED vì collision. Không điền handle khác hộ chủ repo. |
| `staging-confirmation.template.json` | Mã staging, scope `staging`, SHA-256, hạn, approval reference. Status hiện là owner-reported-present, verified false. Không ghi URL. |
| `budget-approval.template.json` | Cap tháng đã ghi. Mã ngân sách vẫn thiếu. Không ghi số tài khoản. |
| `security-legal-approval.template.json` | Mã phê duyệt an ninh và pháp lý. |
| `browser-zalo-policy.template.json` | Browser staging-only, launch off. Zalo/eOffice scope-pending. Không bật browser và không đăng nhập. |
| `artifact-migration-backup.template.json` | Mã artifact, migration, backup và digest. |
| `health-alerting.template.json` | Mã health và alerting từ quy trình riêng. Metadata local không phải probe. |
| `evidence.schema.json` | Đủ mười một field. Mọi dòng đang BLOCKED. |

Không commit bản đã điền. Không đưa secret, token, cookie, private key, credential hay URL vào mẫu.

## Diễn tập local

Incident, rollback, backup/restore, dependency outage, secret/config missing và audit/redaction chạy trong tiến trình. Không dùng dữ liệu thật, không gửi alert, không restore ra ngoài bộ nhớ.

Risk acceptance cần approver khác requester, hạn, scope `local` và mã bằng chứng. Scope production hoặc cờ bypass bị từ chối. `bypassesProduction` luôn là false.

## Điều kiện để một phase sau được xét GO

Phase 12 không chuyển GO. Chủ repo phải đưa, ngoài repository:

1. Bảy handle khác nhau.
2. Bằng chứng staging, ngân sách, an ninh, pháp lý, browser và Zalo/eOffice còn hạn, digest khớp, không phải cờ.
3. Biên bản artifact, migration và backup.
4. Health production và alerting được xác nhận bằng quy trình riêng.
5. License của package. SBOM local không đủ.
6. Không có ngoại lệ nào mở production lock.

Policy: [GOVERNANCE.md](GOVERNANCE.md). An ninh: [SECURITY.md](SECURITY.md).

## Môi trường

| Target | Dry-run | Mạng | Kết quả Phase 5 |
| --- | --- | --- | --- |
| `local` | có | không | Pass nếu live flag tắt và không có secret |
| `staging` | có, chỉ local | không, trừ khi chủ repo xác nhận | URL public làm preflight fail và không được gọi |
| `production` | bị khóa | không | Fail dù `LUNA_DEPLOY_PRODUCTION_OPT_IN=true` |

```bash
npm run deploy:dry-run
npm run deploy:dry-run -- --target staging
npm run deploy:dry-run -- --health http://127.0.0.1:8080/
```

Preflight bắt buộc: phase lock, Firebase live tắt, 9Router live tắt, browser launch tắt, không có secret trong file đã quét, không có endpoint production mới. Firebase rules không được deploy. Quyền public không được mở.

## Rollback

Chiến lược `local-no-op`. Preflight thất bại thì process hiện tại không đổi. Không gọi hosting, không deploy rules, không publish. Muốn quay lại baseline thì dùng commit local của Phase 4 hoặc `main`. Không có thao tác remote trong rollback.

## Adapter

| Adapter | Posture mặc định | Live | Mạng |
| --- | --- | --- | --- |
| Firebase RTDB | memory | `false` | Không socket. Emulator chỉ là transport trong tiến trình và chỉ nhận loopback. |
| 9Router | mock | `false` | Không gọi `/v1/chat/completions`. Chi phí $0. |
| Playwright | stub | launch `false` | Không mở browser. |
| Skyvern | stub | launch `false` | Không mở browser. |
| Browser Use | stub | launch `false` | Không mở browser. |

`FIREBASE_LIVE_ENABLED=true` hoặc `LUNA_ALLOW_LIVE_MODELS=true` làm dry-run deployment thất bại. UI không có nút tắt approval, audit hoặc phase lock.

Chủ repo còn phải quyết trước khi có staging thật: URL staging, người giữ REST credential, ngân sách 9Router, chính sách browser, và khi nào Zalo hoặc eOffice được đụng tới.
