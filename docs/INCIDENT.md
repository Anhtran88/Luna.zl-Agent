# Sự cố Phase 9

Production vẫn **NO-GO**. Incident owner được ghi là kenbi nhưng trùng mọi vai khác, nên vai này vẫn BLOCKED. Không có alerting ngoài. Không gửi cảnh báo. Runbook này không gọi mạng.

1. Dừng thao tác đang định làm. Không deploy, không bật live.
2. Ghi sự cố vào audit local. Không ghi credential.
3. Không fetch Firebase, 9Router, hosting, telemetry hay endpoint public.
4. Không đăng nhập hoặc sửa dữ liệu Zalo/eOffice.
5. Dùng rollback local-no-op ở [ROLLBACK.md](ROLLBACK.md).
6. Báo chủ repo. Handle kenbi đã được ghi nhưng vẫn BLOCKED vì collision. Không suy diễn handle khác.

Chưa có kênh alerting ngoài. Không tạo webhook hay gửi log ra khỏi máy.
