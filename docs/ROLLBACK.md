# Rollback Phase 9

Chiến lược: **local-no-op**. Production đang **NO-GO**.

Phase 10 tập rollback trong bộ nhớ. Phase 11 ghi rehearsal đó vào audit và vẫn không đổi process đang phục vụ. Phase 12 diễn tập lại rollback local-no-op và backup/restore trong bộ nhớ. Rollback owner đang BLOCKED. Backup, health và alerting đang BLOCKED. Mẫu `config/readiness/artifact-migration-backup.template.json` và `config/readiness/health-alerting.template.json` không chứa dữ liệu thật.

1. Nếu preflight thất bại, không đổi process đang chạy.
2. Không gọi hosting, không deploy Firebase rules, không publish.
3. Không mở firewall và không đọc dữ liệu thật.
4. Muốn quay lại baseline thì dùng git ở máy local hoặc `main`. Không có lệnh remote.
5. Backup/restore thật chưa có biên bản. Bản sao trong tiến trình của Phase 7 không phải backup production.

Chưa có rollback owner được xác nhận. Không tự điền tên.
