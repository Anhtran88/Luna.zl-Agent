# Schema persistence Luna v1

Phase 0/1 là schema v0: chỉ bộ nhớ tiến trình, không có tài liệu để nâng. Phase 2 foundations ghi schema v1. Không có migration tự động từ v0.

## Path

| Kind | Path |
| --- | --- |
| settings | `/luna/v1/settings` |
| task | `/luna/v1/tasks/{taskId}` |
| approval | `/luna/v1/approvals/{approvalId}` |
| audit | `/luna/v1/audit/{eventId}` |
| run | `/luna/v1/runs/{runId}` |

Mỗi giá trị là một envelope:

```json
{ "schemaVersion": 1, "kind": "task", "record": {} }
```

## Bất biến v1

- `settings.phaseLock` phải là `true`.
- `settings.firebaseLive` và `settings.modelsLive` phải là `false`.
- Audit và agent run chỉ nhận `dryRun: true`.
- Schema `0` hoặc thiếu version bị từ chối với mã `MIGRATION`.
- Schema khác `1` bị từ chối. Không tự suy diễn tài liệu lạ.

## Firebase live

## Firebase project lunazl-agent

URL công khai, không phải secret:

`https://lunazl-agent-default-rtdb.asia-southeast1.firebasedatabase.app`

Biến mẫu nằm trong [.env.example](../.env.example). `FIREBASE_LIVE_ENABLED` mặc định `false`. Khi tắt, factory trả memory adapter dù URL đã có. Khi bật, factory luôn trả adapter khóa, kể cả có REST credential và transport. Service account JSON không được gửi đi.

Rules mẫu ở [firebase/database.rules.json](../firebase/database.rules.json) là deny đọc và ghi. File này không được deploy và không yêu cầu mở public access.

Adapter REST có trong `src/luna/firebase-rtdb.ts` chỉ phục vụ contract test trên HTTP loopback. Host Firebase được nhận dạng để chẩn đoán cấu hình, nhưng mọi truy cập host thật bị chặn trước transport. App server không tiêm transport.

## Việc chưa làm

Ghi thật lên project Firebase, stream listener, và nâng schema v2. Cả ba cần chủ repo quyết định trước.
