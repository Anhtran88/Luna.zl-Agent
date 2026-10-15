# Staging runbook Phase 8

Quyết định staging hiện tại: **NO-GO**. Production ở Phase 9 cũng là **NO-GO**. Không deploy staging có mạng và không deploy production. Xem [RELEASE.md](RELEASE.md).

`LOCAL-REHEARSAL-ONLY` chỉ xuất hiện khi mọi cổng dưới đây đều pass và URL là loopback. Trạng thái đó vẫn là dry-run: `executed: false`, `networkDeploy: false`, chi phí $0.

```bash
npm run staging:check
```

Lệnh không gọi fetch. Báo cáo chỉ gồm id và mức độ blocker, không gồm giá trị biến môi trường.

## Go / no-go

Dừng ở NO-GO nếu thiếu bất kỳ điều kiện nào:

| Cổng | Biến hoặc kiểm tra | Mức khi thiếu |
| --- | --- | --- |
| URL staging | `LUNA_STAGING_URL` phải là `http://127.0.0.1` hoặc `localhost`. URL public bị từ chối và không được gọi. | Critical |
| Môi trường được xác nhận | `LUNA_STAGING_CONFIRMED` | Critical |
| Chủ môi trường | `LUNA_ENVIRONMENT_OWNER_CONFIRMED` | Critical |
| Chủ credential ngoài git | `LUNA_CREDENTIAL_OWNER_CONFIRMED` | Critical |
| Credential không nằm trong môi trường lệnh | các biến secret để trống | Critical |
| Ngân sách | `LUNA_BUDGET_CONFIRMED` | High |
| Phê duyệt an ninh | `LUNA_SECURITY_APPROVAL` | High |
| Chủ rollback | `LUNA_ROLLBACK_CONFIRMED` | High |
| Rules Firebase | file mẫu deny-all, không deploy | Critical |
| Live flags | Firebase, 9Router, browser và production đều tắt | Critical |
| Policy browser | `LUNA_BROWSER_POLICY_CONFIRMED` | High |
| Policy Zalo/eOffice | `LUNA_ZALO_POLICY_CONFIRMED` | High |
| Schema | v1, additive, không đụng dữ liệu thật | High |
| Artifact | bản build local được ghi nhận, không upload | High |
| Health | chỉ ghi nhận loopback, không fetch | High |
| Smoke | kết quả local được ghi nhận | Medium |
| Rollback | `local-no-op`, không gọi hosting | High |

Cờ `true` chỉ là lời ghi nhận. Nó không mở socket, không cấp quyền và không deploy.

## Mẫu cấu hình

[config/staging.env.example](../config/staging.env.example) chỉ có tên biến. Giá trị để trống. Không điền API key, token, cookie hay service account.

## Nếu URL không phải loopback

Ghi blocker Critical `staging-url` và dừng. Không phân giải host, không fetch, không gọi Firebase, 9Router, hosting hay telemetry. Không suy đoán URL thay thế.

## Rollback

1. Preflight thất bại thì không đổi process đang chạy.
2. Không deploy rules và không publish.
3. Quay lại commit local hoặc `main` bằng git. Không có lệnh remote.

## Blocker đang mở khi chưa có xác nhận

- Critical: chưa có URL staging, chưa có chủ môi trường, chưa có chủ credential.
- High: chưa có ngân sách, phê duyệt an ninh, rollback owner, policy browser và policy Zalo/eOffice.
- Medium: smoke của lần đánh giá mặc định chưa được gắn vào gate.
- Low: không phát sinh ở gate mặc định. Preview framing vẫn là rủi ro Low của Phase 7.
