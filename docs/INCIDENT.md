# Sự cố Phase 9

Production đang **NO-GO**. Runbook này không gọi mạng.

1. Dừng thao tác đang định làm. Không deploy, không bật live.
2. Ghi sự cố vào audit local. Không ghi credential.
3. Không fetch Firebase, 9Router, hosting, telemetry hay endpoint public.
4. Không đăng nhập hoặc sửa dữ liệu Zalo/eOffice.
5. Dùng rollback local-no-op ở [ROLLBACK.md](ROLLBACK.md).
6. Báo chủ repo. Phase 9 chưa có incident owner nên không tự gán tên.

Chưa có kênh alerting ngoài. Không tạo webhook hay gửi log ra khỏi máy.
