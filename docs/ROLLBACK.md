# Rollback Phase 9

Chiến lược: **local-no-op**. Production đang **NO-GO**.

Rollback owner được ghi là kenbi nhưng trùng requester, nên vai này vẫn BLOCKED. Backup, health và alerting vẫn BLOCKED. Cap tháng đã ghi nhưng không phát sinh phí. Staging được báo đã có và chưa verified.

1. Nếu preflight thất bại, không đổi process đang chạy.
2. Không gọi hosting, không deploy Firebase rules, không publish.
3. Không mở firewall và không đọc dữ liệu thật.
4. Muốn quay lại baseline thì dùng git ở máy local hoặc `main`. Không có lệnh remote.
5. Backup/restore thật chưa có biên bản. Bản sao trong tiến trình của Phase 7 không phải backup production.

Chưa có rollback owner tách biệt. Kenbi trùng requester nên vai này vẫn BLOCKED. Không tự điền tên khác.
