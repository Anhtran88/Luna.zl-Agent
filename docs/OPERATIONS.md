# Vận hành Phase 4

Phase 4 chuẩn bị contract của adapter thật. Không adapter nào được phép tự mở mạng.

| Adapter | Posture mặc định | Live | Mạng |
| --- | --- | --- | --- |
| Firebase RTDB | memory | `false` | Không socket. Emulator chỉ là transport trong tiến trình và chỉ nhận loopback. |
| 9Router | mock | `false` | Không gọi `/v1/chat/completions`. Chi phí $0. |
| Playwright | stub | launch `false` | Không mở browser. |
| Skyvern | stub | launch `false` | Không mở browser. |
| Browser Use | stub | launch `false` | Không mở browser. |

`FIREBASE_LIVE_ENABLED=true` hoặc `LUNA_ALLOW_LIVE_MODELS=true` chỉ được ghi nhận. Thiếu credential thì quyết định là `missing-credential`. Có credential giả lập thì vẫn `phase-lock`. UI không có nút tắt approval, audit hoặc phase lock.

Không deploy rules Firebase. Không đặt service account, API key, cookie hay token vào git.

Chủ repo còn phải quyết: ai giữ REST credential, có gọi 9Router live và ngân sách bao nhiêu, khi nào browser thật được duyệt, và khi nào Zalo hoặc eOffice được đụng tới.
