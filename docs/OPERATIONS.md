# Vận hành Phase 12

Phase 12 kiểm operational readiness và continuous compliance ở máy local. Production vẫn **NO-GO**. Quyền deploy **not-granted**. Phase này không chấp nhận cờ `*_CONFIRMED=true` làm sign-off.

```bash
npm run ops:check
npm run governance:check
npm run validate:sim
npm run production:check
npm run security:check
```

`ops:check` không gọi mạng. Báo cáo có evidence score, blocker id, compliance và sáu diễn tập. Không in handle hay credential.

## Checklist

Bảy vai đang unassigned: requester, approver, chủ staging, chủ credential, security reviewer, chủ rollback, chủ sự cố. Không gán cùng một người.

Bằng chứng cần mã opaque, digest SHA-256, timestamp và source-type: staging, ngân sách, phê duyệt an ninh, pháp lý, policy browser, policy Zalo/eOffice, artifact, migration, backup. Health production và alerting ngoài không được probe trong phase này.

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
