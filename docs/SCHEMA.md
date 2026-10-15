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

Adapter REST có trong `src/luna/firebase-rtdb.ts`. Process mặc định không tạo client đó. Muốn gọi REST phải có đủ URL `*.firebasedatabase.app` hoặc `*.firebaseio.com`, cờ live, một REST token trong bộ nhớ, và một transport do caller tiêm vào. Service account JSON không phải REST token và không được gửi. App server không tiêm transport, nên không mở socket.

## Việc chưa làm

Ghi thật lên project Firebase, stream listener, và nâng schema v2. Cả ba cần chủ repo quyết định trước.
