# Production readiness Phase 7

Quyết định production: **NO-GO**.

Điểm kỹ thuật local có thể là 100/100. Điểm đó không cho phép deploy. Cờ xác nhận của chủ repo, dù được đặt, cũng không bật Firebase, 9Router, browser hay production.

```bash
npm run readiness
```

Lệnh in báo cáo JSON và thoát 0 khi câu trả lời là NO-GO và rules vẫn deny-all. Không gửi telemetry, không gọi mạng.

## Checklist

| Nhóm | Trạng thái local | Ghi chú |
| --- | --- | --- |
| Application | pass | Control plane dry-run |
| Security | pass khi live flag tắt | Phase lock, Firebase, 9Router, browser, production |
| Data | pass | Schema v1, không đụng dữ liệu thật |
| Observability | pass | Log local, correlation id, redaction |
| Reliability | pass | Retry, idempotency, circuit breaker, shutdown offline |
| Cost | pass | $0 |
| Rollback | pass | `local-no-op` |
| Access control | pass | Approval và audit không bypass |
| Incident | pass | Thủ tục local, không có kênh production |
| Owner gates | missing | Staging, credential, ngân sách, duyệt an ninh, rollback, browser, Zalo/eOffice |

## Risk register

| ID | Mức | Trạng thái | Đóng khi |
| --- | --- | --- | --- |
| no-staging | Critical | open | Chủ repo chấp nhận môi trường staging. Cờ env không đủ. |
| no-credential-owner | Critical | open | Có người giữ credential ngoài git. |
| no-budget | High | open | Ngân sách Firebase, 9Router và browser được chốt. |
| no-security-approval | High | open | Có phê duyệt an ninh cho production. |
| no-product-policy | High | open | Có chính sách browser và quyết định Zalo/eOffice. |
| memory-only-data | Medium | open | Có backup thật sau staging và credential. |
| preview-framing | Low | open | Chủ repo quyết có khoá iframe hay không. |

Owner của mọi rủi ro đang mở là chủ repo. Không ghi tên người thật và không ghi credential.

## Go / no-go

Production là NO-GO cho đến khi đủ các điều kiện sau, và ngay cả khi đủ thì phase này vẫn không deploy:

1. Môi trường staging được xác nhận.
2. Có chủ credential.
3. Có ngân sách.
4. Có phê duyệt an ninh.
5. Có kế hoạch rollback được chấp nhận.
6. Có policy browser.
7. Có policy Zalo và eOffice.

## Backup, retention, privacy

Backup và restore trong phase này là bản sao JSON trong tiến trình. Payload chứa credential bị từ chối và không được in. Dữ liệu tác vụ chỉ sống đến khi process tắt. Không có truy cập dữ liệu thật. Schema hiện tại là v1, chỉ thêm trường, không xoá dữ liệu production vì chưa có dữ liệu đó.

## Chi phí

Firebase, 9Router và browser đều tắt. Ước tính $0. Không có lệnh nào trong phase này tạo hoá đơn.
