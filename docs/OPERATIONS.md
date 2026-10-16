# Vận hành Phase 11

Phase 11 kiểm tra policy local. Production vẫn NO-GO. Không publish và không bật live.

```bash
npm run governance:check
npm run validate:sim
npm run production:check
npm run security:check
```

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
