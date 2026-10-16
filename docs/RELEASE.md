# Release Phase 9

Quyết định: **NO-GO**. Quyền deploy: **not-granted**.

Phase 12 ghi quyết định chủ repo và vẫn **NO-GO**. License MIT không đóng production gate. Owner collision còn mở. Staging mới được báo là có và chưa verified. Cap tháng không phải quyền deploy.

Phase 9 chỉ lập hồ sơ. Đủ sign-off trên giấy cũng không làm lệnh này deploy. Health production và alerting ngoài cố ý để mở vì không được gọi mạng.

```bash
npm run production:check
```

## Change record

| Mục | Giá trị |
| --- | --- |
| Release | `9-production` |
| Decision | NO-GO |
| Network | không |
| Production deployed | không |
| Chi phí | $0 |
| Nội dung | Cổng production, checklist, sign-off và runbook. Không có secret. |

## Checklist

- [ ] URL staging được chủ repo xác nhận. URL public không được điền vào git.
- [ ] Có chủ môi trường.
- [ ] Có chủ credential ngoài git.
- [ ] Có ngân sách.
- [ ] Có phê duyệt an ninh.
- [ ] Có chủ rollback.
- [ ] Có chủ sự cố.
- [ ] Có policy browser.
- [ ] Có policy Zalo/eOffice.
- [ ] Có yêu cầu legal/privacy.
- [ ] Có hash artifact và inventory dependency local.
- [ ] Có drill backup/restore. Tài liệu mock chưa đủ.
- [ ] Health production vẫn chưa được probe.
- [ ] Alerting ngoài vẫn chưa được bật.

## Sign-off

| Vai trò | Trạng thái mặc định | Cấp quyền deploy |
| --- | --- | --- |
| Staging | missing | không |
| Environment owner | missing | không |
| Credential owner | missing | không |
| Budget | missing | không |
| Security | missing | không |
| Rollback owner | missing | không |
| Incident owner | missing | không |
| Browser policy | missing | không |
| Zalo/eOffice policy | missing | không |
| Legal/privacy | missing | không |

Không ghi tên người thật. Cờ môi trường `true` chỉ đổi trạng thái thành claimed và vẫn không cấp quyền deploy.
