# Governance Phase 11

Quyết định staging và production: **NO-GO**. Quyền deploy: **not-granted**.

Phase 11 không chấp nhận cờ `*_CONFIRMED=true` làm sign-off. Cờ đó là xác nhận giả. Không gán requester, approver, chủ môi trường, chủ credential, security reviewer, chủ rollback và chủ sự cố cho cùng một người.

```bash
npm run governance:check
```

Lệnh không gọi mạng. Báo cáo chỉ có id của blocker, không có handle hay credential.

## RACI

Mọi vai đang **unassigned**. Không điền tên thật.

| Việc | Requester | Approver | Environment | Credential | Security | Rollback | Incident |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Yêu cầu staging hoặc production | A | C | C | C | C | I | I |
| Bật live hoặc browser | A | C | C | C | C | I | I |
| Rollback ngoài máy local | A | C | I | I | C | A | C |

A = thực hiện, C = phải đồng ý, I = được báo. Ô trống nghĩa là chưa có người. Không tự điền một operator cho mọi cột.

## Workflow

1. Requester tạo yêu cầu local.
2. Policy gate kiểm tra handle tách biệt và mã bằng chứng.
3. Thiếu field, trùng vai, cờ giả, URL public, live flag hoặc rules không deny-all thì chặn.
4. Đủ bằng chứng local cũng chỉ được ghi nhận. Gate không cấp quyền và không deploy.
5. Audit ghi policy, approval, dry-run, rollback rehearsal và live bypass. Credential bị giấu.

## Bằng chứng cần có

- Handle khác nhau cho bảy vai separation-of-duties.
- Mã bằng chứng cho môi trường staging, ngân sách, phê duyệt an ninh, policy browser, policy Zalo/eOffice và legal/privacy.
- Mã không phải `true`, không phải URL và không phải credential.
- Rules Firebase vẫn deny-all và không được deploy.

## Điều kiện NO-GO

Thiếu bất kỳ mục trên, hoặc có cờ xác nhận giả, thì staging và production là NO-GO. Kể cả khi đủ mục, phase này vẫn không gọi mạng.

## Phase 12

Operational readiness không đổi RACI và không chấp nhận cờ. Sổ bằng chứng chỉ lưu digest, thời điểm và source-type. Secret, URL và `*_CONFIRMED=true` bị từ chối. Đủ bằng chứng local vẫn là NO-GO. Xem [OPERATIONS.md](OPERATIONS.md).
