# Rollback Phase 9

Chiến lược: **local-no-op**. Production đang **NO-GO**.

Phase 10 tập rollback trong bộ nhớ: đổi nhãn release, shutdown, idempotency và từ chối payload có credential. Tập đó không đổi process đang phục vụ và không chạm dữ liệu thật.

1. Nếu preflight thất bại, không đổi process đang chạy.
2. Không gọi hosting, không deploy Firebase rules, không publish.
3. Không mở firewall và không đọc dữ liệu thật.
4. Muốn quay lại baseline thì dùng git ở máy local hoặc `main`. Không có lệnh remote.
5. Backup/restore thật chưa có biên bản. Bản sao trong tiến trình của Phase 7 không phải backup production.

Chưa có rollback owner được xác nhận. Không tự điền tên.
