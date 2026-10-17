# Trusted runtime: kỹ thuật đã có, activation vẫn NO-GO

## Hai đường chạy tách biệt

Demo local giữ auth-off, memory/mock và không approve/execute. Verified runtime dùng Better Auth đã có trong app, signed server policy và PostgreSQL riêng. Không dùng `requireUserId()` dev fallback. Thiếu identity/policy/database hoặc target staging mà chưa auth thì từ chối, không trả dữ liệu demo hay workspace khác.

Không thêm Firebase Auth song song: app đã có Better Auth, session DB, xác minh session cookie hoặc token opaque và client đăng nhập qua broker. `/login` và `/api/auth/*` được nối vào cơ chế đó; mặc định route auth trả `AUTH_DISABLED`, không import/khởi động provider nếu chưa cấu hình đầy đủ. Email/password vẫn tắt. Không thực hiện sign-in thật trong lần kiểm chứng này.

Session lookup dùng `auth.api.getSession` với cookie cache **disabled** để kiểm DB revocation/expiry. Kết quả phải có verified user ID, session userId khớp và expiry hợp lệ trong tương lai. `x-user-id`, roles từ body/header, email hoặc dev-user không cấp quyền. Fetch-Metadata guard của app chặn scripted cross-site/sibling requests.

## Signed policy và Separation of Duties

`config/access-policy.template.json` không cấp ai quyền. Server đọc JWS từ file ngoài repo, xác minh Ed25519 bằng **public JWK được pin qua cấu hình server**. Không lấy key từ `jku`/`x5u` hoặc request. JWT phải có:

- `iss`: đúng `LUNA_POLICY_ISSUER` do owner xác nhận;
- `aud`: `luna-local-access`, `sub`: `luna-access-policy`;
- `iat` và `exp` hợp lệ, thời hạn tối đa 24 giờ;
- `policy`: object version 1 với `workspaces`.

Mỗi workspace có `id` opaque (`[a-z0-9][a-z0-9_-]{0,63}`) và `duties` gồm đủ bảy key: `requester`, `approver`, `environment-owner`, `credential-owner`, `security-reviewer`, `rollback-owner`, `incident-owner`. Giá trị ban đầu là null; sau khi owner duyệt là `better-auth:<verified-user-id>`. Không dùng email/handle tự khai để thay ID. Mỗi account hiện chỉ gắn một workspace; mọi member được cấp quyền đọc chung workspace đó. Không có chọn workspace/owner từ client.

Requester tạo/plan/cancel/execute **task của chính mình**; approver duyệt task của requester khác. Approve/execute chỉ được xét khi cả bảy vai có principal đầy đủ và khác nhau. Chuyển role không tự chuyển ownership task cũ. Các role governance khác có quyền đọc workspace, không tự có quyền requester/approver.

Signature là consent cho **truy cập local simulation**, không phải sign-off live hoặc deployment. Policy được đọc/xác minh lại mỗi request và recheck expiry sau khi lấy row lock; xóa/sửa policy thu hồi quyền cho request tiếp theo. Cần renewal/rotation trước khi hết hạn. Unique account ID không chứng minh hai người độc lập; owner phải xác minh không dùng nhiều tài khoản của cùng một người để lách SoD.

**Bảy vai kenbi trong governance hiện tại vẫn BLOCKED.** Không đổi hồ sơ/bằng chứng đó. Policy thật chưa được cung cấp; fixtures độc lập chỉ có trong tests. Snapshot governance/ops vẫn NO-GO dù happy local simulation trong test có đủ policy fixtures.

## Persistence và recovery

`migrations/luna/0001_atomic_workspaces.sql` là migration **opt-in**, không tự chạy trong build. Hai table:

- `luna_workspaces`: một document/checkpoint và revision cho mỗi workspace;
- `luna_command_receipts`: request ID, verified subject, SHA-256 command fingerprint và outcome; PK `(workspace_id, request_id)`.

Transaction giữ một reserved PG connection, `SELECT ... FOR UPDATE`, kiểm revision bằng CAS, ghi checkpoint + provenance audit + receipt rồi COMMIT. Tất cả query scope bằng workspace do signed policy cấp và dùng parameters. State, owner mapping, approvals, runs, toàn bộ audit và recovery flags được lưu chung; không snapshot từ UI làm source of truth. Hydration từ chối schema/live mode và plan/approval state không khớp.

Retry cùng key/subject/nội dung trả outcome cũ rồi đọc snapshot hiện tại. Khác nội dung/subject nhận `REPLAY_CONFLICT`. Request mới cho approval đã quyết định hoặc terminal execute không tạo thêm success audit/run. Client giữ opaque request ID + payload digest trong sessionStorage khi mất mạng, `PERSISTENCE_UNCERTAIN`, hoặc phải re-auth/renew policy sau lost ACK; không lưu token hoặc nội dung task ở retry metadata. Receipt đã commit trả `acknowledged=true` kể cả business rejection; khi ACK chắc chắn mới bỏ key.

Ghi state thành công nhưng receipt lỗi → transaction rollback cả hai. Crash trước commit → rollback; crash sau commit/mất ACK → retry đọc receipt, không thực thi lại. Không tự xóa receipt theo TTL; xóa receipt có thể làm mất bảo đảm replay. Cần policy retention/backup do owner phê duyệt.

Executor ở đây **chỉ local simulation**: hydrate bằng empty environment, Firebase memory, model mock, browser stub, mọi external write refused. Transaction không bao quanh hành động ngoài hệ thống. Không tuyên bố exactly-once cho side effect thật; trước khi thêm integration thật cần outbox/lease/fencing và adapter-specific idempotency, được review riêng.

## Bằng chứng local và giới hạn

- Verifier mocks chỉ trong tests: positive identity, null/revoked/expired/malformed/mismatched sessions và forged user/role headers.
- Signed JWT tests: public key/issuer/expiry/SoD; role đúng/sai, principal thiếu và grant hết hạn.
- SQL integration chạy PostgreSQL engine PGLite thật, trên disk local: hai service instances chung DB, duplicate/stale commands, workspace isolation, partial receipt write failure, lost ACK, reopen pending approval/completed run.
- Process con thực bị **SIGKILL** trước/sau commit; reopen kiểm rollback hoặc recover receipt. Không thay test bằng JSON persistence giả.
- PG connection-port tests kiểm reserved clients, COMMIT/ROLLBACK/release. PGLite serialize transactions trong một engine; chưa có bằng chứng load/concurrent **network PostgreSQL connections** hoặc provider backup/HA. Cần kiểm trên DB staging được owner cấp sau này.
- E2E dev/built chỉ local demo, auth disabled, login disabled và deny/cancel/reload. Không gọi identity broker hoặc đăng nhập account thật. Positive verified flow được kiểm qua verifier/SQL integration, chưa phải live sign-in E2E.

## Owner cần cung cấp trước khi bật verified staging

1. **Identity và HTTPS app origin**: chọn/đăng ký client broker cho app hiện có, callback đúng `/api/auth/oauth2/callback/grok-google` và `/api/auth/oauth2/callback/grok-x` nếu dùng; xác nhận issuer/provider được phép. Cấp `BETTER_AUTH_URL`, strong `BETTER_AUTH_SECRET`, `GROK_AUTH_CLIENT_ID/SECRET` và approved `GROK_AUTH_ISSUER` qua secret manager, không qua PR/chat. Public RTDB URL không phải app origin/callback.
2. **Session DB**: owner chọn PostgreSQL được phép, budget/region/retention/TLS và cấp `DATABASE_URL` ngoài git. DB admin áp dụng `migrations/auth/0001_auth.sql` theo quy trình của template trước khi dùng auth. Không dùng preview shared client/in-memory sessions làm production identity.
3. **Bảy principal độc lập**: lấy verified Better Auth IDs từ hệ thống auth có kiểm chứng; xác nhận người thực và trách nhiệm requester/approver/environment/credential/security/rollback/incident. Không tự gán hết kenbi. Owner ký manifest workspace/duties, có issuer, expiry và bản ghi review; public JWK/trust anchor chuyển qua kênh infra tin cậy, private signing key giữ ngoài app/repo. Cấp read-only paths `LUNA_ACCESS_POLICY_FILE`, `LUNA_POLICY_PUBLIC_KEY_FILE`, `LUNA_POLICY_ISSUER`. Có quy trình renew/revoke/rotate.
4. **Luna DB**: owner chọn/approve PostgreSQL (có thể dùng cùng cluster nếu được duyệt, nhưng binding tách biệt), budget cụ thể và backup/restore/retention. DB admin áp dụng `migrations/luna/0001_atomic_workspaces.sql`, cấp app role SELECT/INSERT/UPDATE đúng hai table; không cấp quyền DDL cho app. Cấp `LUNA_DATABASE_URL` với TLS ngoài git, rồi cấu hình `LUNA_STORE_MODE=postgres`. Không tự chấp thuận chi phí PostgreSQL mới; caps Firebase/9Router/browser vẫn $1 mỗi dịch vụ.
5. **Activation review**: sau các mục trên mới đặt `LUNA_IDENTITY_PROVIDER=better-auth`, `VITE_AUTH_ENABLED=true` trong cấu hình runtime/build được duyệt. Chạy sign-in/revocation/isolation/SoD/replay/crash/backup tests trên staging được cấp; chưa có kết quả thì không đánh dấu staging-ready. Thiếu config/migration không fallback sang memory cho verified users.
6. **Trước live**: giải quyết 19 ops blockers, evidence digest/expiry/scope, security/privacy approval và phân công độc lập; đồng thời duyệt ngân sách/rules/least-privilege scopes/rollback. Firebase staging `lunazl-agent-staging-6dd7a` vẫn deny-all, **không probe/đổi Rules/kết nối** trong task này. Không dùng privileged credentials vượt Rules. Zalo/eOffice vẫn simulated read-only; không login/gửi/edit/submit hoặc ghi PDF thật.

Trạng thái hiện tại: cơ chế kỹ thuật đã có code/tests local; identity/client secrets, signed policy/principals, PostgreSQL cấp thật, network-DB/live sign-in validation và giấy tờ governance còn phụ thuộc owner. Không deploy/merge, không cấp staging/live GO.
