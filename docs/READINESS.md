# Production readiness Phase 7

Quyết định production: **NO-GO**.

Phase 12 ghi quyết định chủ repo mà vẫn NO-GO: mọi vai là kenbi nên owner collision còn mở. Staging được báo đã có nhưng chưa verified. Cap tháng là Firebase 0 USD, 9Router 1 USD, Browser 1 USD; cap không phải bằng chứng và không phát sinh phí. Browser chỉ được xét ở staging, launch vẫn tắt. Zalo/eOffice đang scope-pending. License MIT không cấp quyền deploy. Xem [OPERATIONS.md](OPERATIONS.md) và `config/readiness/owner-decisions.json`.

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
| Owner gates | missing | Kenbi không phải cờ xác nhận. Cap đã ghi nhưng bằng chứng ngân sách, staging verified, an ninh, rollback, browser và Zalo/eOffice vẫn thiếu. |

## Risk register

| ID | Mức | Trạng thái | Đóng khi |
| --- | --- | --- | --- |
| owner-collision | Critical | open | Bảy vai có handle khác nhau. Cùng một người không đủ. |
| no-staging | Critical | open | Có evidence an toàn và staging owner khác requester. Báo cáo chưa verified không đủ. |
| no-credential-owner | Critical | open | Có handle credential khác requester, ngoài git. |
| no-budget | High | open | Có bằng chứng ngân sách. Cap tháng không đủ và không phải cờ xác nhận. |
| no-security-approval | High | open | Có phê duyệt an ninh cho production. |
| no-product-policy | High | open | Staging verified, evidence browser hợp lệ, hết collision, approval gate đạt, và Zalo/eOffice có scope được phê duyệt. |
| memory-only-data | Medium | open | Có backup thật sau staging và credential. |
| preview-framing | Low | open | Chủ repo quyết có khoá iframe hay không. |

Owner của mọi rủi ro đang mở là chủ repo. Assignee đã ghi là kenbi và vẫn BLOCKED vì trùng vai. Không ghi credential.

## Go / no-go

Production là NO-GO cho đến khi đủ các điều kiện sau, và ngay cả khi đủ thì phase này vẫn không deploy:

1. Môi trường staging được xác minh, không chỉ được báo là đã có.
2. Có chủ credential khác requester.
3. Có bằng chứng ngân sách. Cap tháng không đủ.
4. Có phê duyệt an ninh.
5. Có kế hoạch rollback được chấp nhận.
6. Có policy browser đã đủ điều kiện launch. Launch hiện vẫn tắt.
7. Có scope Zalo và eOffice cụ thể do chủ repo phê duyệt. Scope đang pending.

## Backup, retention, privacy

Backup và restore trong phase này là bản sao JSON trong tiến trình. Payload chứa credential bị từ chối và không được in. Dữ liệu tác vụ chỉ sống đến khi process tắt. Không có truy cập dữ liệu thật. Schema hiện tại là v1, chỉ thêm trường, không xoá dữ liệu production vì chưa có dữ liệu đó.

## Chi phí

Firebase, 9Router và browser đều tắt. Ước tính $0. Không có lệnh nào trong phase này tạo hoá đơn.
