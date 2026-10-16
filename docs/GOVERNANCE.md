# Governance Phase 11

Quyết định staging và production: **NO-GO**. Quyền deploy: **not-granted**.

Phase 11 không chấp nhận cờ `*_CONFIRMED=true` làm sign-off. Cờ đó là xác nhận giả. Không gán requester, approver, chủ môi trường, chủ credential, security reviewer, chủ rollback và chủ sự cố cho cùng một người.

```bash
npm run governance:check
```

Lệnh không gọi mạng. Báo cáo chỉ có id của blocker, không có handle hay credential.

## RACI

Chủ repo đã ghi `kenbi` cho mọi vai. Đó là collision, không phải người tách biệt. Ma trận dưới đây không có bảy người độc lập.

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

## Quyết định chủ repo

Chủ repo gán requester, approver, staging owner, credential owner, security reviewer, rollback owner và incident owner cho cùng handle `kenbi`. Gate ghi collision và giữ separation-of-duties **BLOCKED**. Không nhận đó là bảy vai độc lập và không đổi cờ `*_CONFIRMED` thành true.

Cap tháng: Firebase 0 USD, 9Router 1 USD, Browser 1 USD. Vượt cap thì từ chối, không gọi dịch vụ và không phát sinh phí. Cap không phải sign-off.

Staging: chủ repo báo đã có (`owner-reported-present`) nhưng `verified` là false. Không probe và không lưu URL. Staging owner vẫn trùng requester.

Browser automation chỉ được xét trong staging, cap 1 USD/tháng. Launch vẫn tắt cho tới khi staging được xác minh, evidence browser hợp lệ, hết owner collision và approval gate đạt. Production browser bị cấm.

Zalo/eOffice: `authorization=scope-pending`. Mọi thao tác thật vẫn khóa. Không suy diễn scope.

License MIT không cấp quyền deploy. Copyright giữ `Anhtran88`.
