# Local auth, state và staging RTDB

## Phạm vi và invariants

Đây là thay đổi local-only trên app hiện tại. Không thêm identity provider, credential, database socket, deploy hay durable storage. Không cấp quyền cho owner được khai báo trong repo.

1. HTTP approve/reject/execute phải qua `runOperatorCommand`. Chưa có trusted identity/role resolver hoặc owner authorization nên cả ba lệnh đều bị từ chối với `AUTH_REQUIRED`, kể cả khi template auth-off. Payload/header tự khai role không được dùng làm principal. Create/plan/cancel/snapshot vẫn là demo local với dữ liệu tổng hợp, chưa có per-user isolation.
2. Pure role contract chỉ nhận context từ server đáng tin: authenticated, đúng role approver/executor, không owner collision và có owner authorization. Fixtures chỉ kiểm policy; không được nối vào runtime hoặc gán quyền cho kenbi.
3. Mỗi control-plane instance chỉ cho một mutation/task đang chạy. Lệnh đua nhận `BUSY`, phải đọc lại state trước retry; không tự queue một quyết định cũ. Duplicate approval bị từ chối, không đổi quyết định đầu và không thêm decision audit. Terminal execute replay không thêm run hoặc success audit.
4. Snapshot, kết quả command và memory-store reads/writes phải tách tham chiếu, kể cả nested plan. Không thể sửa bản đọc để tự duyệt hoặc đổi persistence mà không gọi write.
5. Khi mutation lỗi sau khi đã đổi state hoặc gặp lỗi I/O không xác định, task chuyển blocked trong instance, các lần tiếp theo nhận `RECOVERY_REQUIRED`. Không tự retry khi chưa biết phần nào đã ghi. Store hiện không có transaction/CAS; trạng thái persisted có thể ghi một phần và cần đối chiếu thủ công. Không hứa exactly-once qua nhiều worker hoặc restart.
6. Browser reload đọc lại cùng server memory. New plane/process không hydrate tasks/approvals/runs/audit từ store. Stored task cũ không được tự phục hồi quyền execute; trả `NOT_FOUND`. Không coi test tạo instance mới là restart persistence thực. Chưa có disk persistence để kiểm process restart/recovery.

## Acceptance tests

| Test | Bằng chứng local |
| --- | --- |
| `authorization.test.ts` | Thiếu auth/role, role nhầm, owner collision hoặc thiếu owner authorization đều deny. Server command boundary không gọi work và không sửa state. |
| `concurrency.test.ts` | Hai execute chỉ có một run; duplicate/opposite approval chỉ có một quyết định/audit; barrier giữ mock model để kiểm execute/cancel race không dùng sleep; detached snapshot/store; persistence-failure quarantine; new plane không tự execute stored task. |
| `staging-config.test.ts` | Binding staging riêng; thiếu/sai project/origin hoặc selector sai phải fail, không fallback generic; live flag và dummy credential vẫn locked, không gọi mạng. |
| `test:e2e` | Desktop/mobile trên dev và built: approve, reject, execute bị deny; task không đổi trước cancel, không có success audit; cancel rồi reload giữ task/audit trong cùng process. Happy dry-run vẫn được test trực tiếp trong core simulation, không mở HTTP bypass để E2E xanh. |

## Staging RTDB riêng

Chủ dự án xác nhận project `lunazl-agent-staging-6dd7a`, region `asia-southeast1`, RTDB origin `https://lunazl-agent-staging-6dd7a-default-rtdb.asia-southeast1.firebasedatabase.app` và Rules đã deny-all (`.read=false`, `.write=false`). Đây là thông tin public và xác nhận từ owner; Codex không probe endpoint hoặc tự cấp evidence/sign-off cho governance. Không sửa project production `lunazl-agent` hay production template.

`config/staging.env.example` chỉ là template, không tự load. Cấp biến runtime từ bên ngoài repo:

- `LUNA_FIREBASE_ENVIRONMENT=staging` chọn binding staging, độc lập `LUNA_DEPLOY_TARGET`; mặc định `local` giữ loader cũ.
- `STAGING_FIREBASE_PROJECT_ID` và `STAGING_FIREBASE_DATABASE_URL` phải khớp chính xác project/origin trên. Không chấp nhận path/query, URL production hoặc fallback generic.
- `STAGING_FIREBASE_SERVICE_ACCOUNT_JSON` để trống. Generic `FIREBASE_SERVICE_ACCOUNT_JSON` và generic live flags không được dùng cho staging.
- `STAGING_FIREBASE_LIVE_ENABLED=false`; kể cả true cũng chỉ chọn locked adapter, không mở socket. Mặc định vẫn memory. Không cần credential cho local rehearsal.
- Preflight live/secret/endpoint và các staging/production reports cũng kiểm biến staging mới; không được báo credential-absent hoặc live-flags đạt khi các binding này được điền/yêu cầu live.
- `LUNA_STAGING_URL` là URL app/rehearsal, không phải RTDB; vẫn để trống. Không gán RTDB origin vào biến này. Không thay đổi rules/deploy config.

Trước bất kỳ kết nối thực nào sau này, owner phải giải quyết auth/session verification và role mapping, separation of duties/owner collision, credential owner và least-privilege binding ngoài git, scope đọc/ghi tối thiểu, ngân sách $1/dịch vụ, rules review và kế hoạch rollback. Cần authorization mới cho kết nối có kiểm soát. Deny-all được xác nhận không đồng nghĩa app staging-ready; privileged credentials cũng không được dùng để vượt Rules đang khóa. Hiện vẫn **NO-GO**, không network/deploy, không Zalo/eOffice live.
