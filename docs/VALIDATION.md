# Validation mô phỏng Phase 10

Kết quả: **simulated-only**. Production vẫn **NO-GO**.

Đây không phải production validation. Không có deployment thật, không có staging có mạng và không có telemetry.

```bash
npm run validate:sim
```

`LUNA_VALIDATION_TARGET=staging` hoặc `production` bị từ chối. Harness không gọi URL đó.

## Đã mô phỏng

| Kịch bản | Kết quả local |
| --- | --- |
| healthy | `healthy-local` |
| degraded | `degraded` |
| timeout | `timeout`, chi phí $0 |
| partial-failure | `rolled-back` |
| dependency-unavailable | `unavailable` |
| schema-mismatch | `incompatible` khi khác v1, không migrate |
| secret/config missing | giấu credential, không in |
| artifact mismatch | nhận mismatch, không in hash |
| rollback | đổi nhãn `10-validation` sang `9-production` trong hồ sơ, không áp vào process |
| api-contract | schema v1, dry-run, không gọi HTTP |
| observability | log local và correlation id |
| alerting | `not-sent` |

Rollback rehearsal kiểm tra shutdown, idempotency, bản sao JSON trong tiến trình và audit đã giấu. Không đụng dữ liệu thật.

## Chưa thể xác minh

- production-deployment
- production-health
- staging-network
- external-alerting
- credential-owner
- real-user-data
- ui-against-production

Smoke desktop/mobile chỉ kiểm tra preview local. Nó không chứng minh UI production.

## Acceptance

Mô phỏng được chấp nhận khi các kịch bản lỗi bị giữ trong tiến trình, rollback không ra mạng và báo cáo giữ `productionValidated: false`. Tiêu chí production validation cố ý **không** đạt.
