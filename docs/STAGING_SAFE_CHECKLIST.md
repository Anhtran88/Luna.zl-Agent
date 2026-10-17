# Checklist staging-safe local

Luna chưa hoàn thiện ở mức staging-safe. Checklist này không cấp quyền staging/live/deploy; production vẫn NO-GO. Không dùng dữ liệu thật, credential hay storage root cá nhân trong repo. Public RTDB coordinates do owner cung cấp được ghi riêng trong [local contract](LOCAL_AUTH_STATE_CONTRACT.md); không phải quyền kết nối.

| Ưu tiên | Nhóm | Đã có trong repo | Còn thiếu để đánh giá hoàn thiện |
| --- | --- | --- | --- |
| P0 đã đóng | Test reproducibility | `npm ci` + `npm test` chạy từ source sạch không có `.grok`. Tracked config giữ auth-off; bốn upstream OG contracts skip rõ lý do, `test:upstream` bắt buộc và fail khi thiếu/sai nguồn. CI chạy toàn suite và E2E. | Nếu cần xác minh prompt nền tảng, cung cấp nguồn upstream thật theo [TESTING.md](TESTING.md); không tạo fixture giả. |
| P0 | Auth/roles | HTTP approve/reject/execute bị deny khi chưa có trusted resolver. Fixtures kiểm thiếu auth/role, role nhầm, owner collision và owner authorization; không gán quyền thật. | Định nghĩa identity và quyền requester/approver cho staging. Viết test local cho truy cập không được phép, tự duyệt và cách ly người dùng trước khi xét mở quyền truy cập từ xa. Không tự bật auth/live. |
| P1 luồng cơ bản đã có | Task + approval + audit | Core simulation kiểm happy flow. UI E2E nay kiểm approve/reject/execute fail-closed → cancel → audit/reload. Race/replay và detached memory state có deterministic regression. | Durable restart/recovery, transaction/CAS và multi-worker dedup chưa có. Lỗi ghi không chắc chắn bị quarantine, không tự retry. Không coi memory là persistence staging. |
| P1 | UI/flows | E2E dev/built trên desktop/mobile, 12 kịch bản, kiểm auth denial không đổi state/success audit, cancel/reload, không overflow, không uncaught app error; giữ NO-GO. | Bổ sung UX lỗi/loading, reload/retry và thử lỗi transport local có kiểm soát. |
| P1 | Adapter contracts | Firebase factory khóa dù có token/transport; REST test chỉ loopback. 9Router mock, browser stub; Zalo/eOffice chỉ mô phỏng đúng scope. | Giữ contract tests âm trên mọi đường đọc/ghi và chứng minh không gọi transport ngoài; contract mô phỏng không chứng minh dịch vụ thật sẵn sàng. |
| P1 | Proof/governance | Evidence có digest/hạn/scope/ref; cờ `true` không đóng sign-off; cap $1/dịch vụ giữ nguyên. | Bằng chứng thực và bảy vai độc lập vẫn thiếu; health/alerting không được giả lập thành proof production. Hạng mục này giữ BLOCKED, không điền hộ hay bật cổng. |

Hạng mục tiếp theo cần owner quyết định identity/roles và SoD; kỹ thuật local còn durable transaction/recovery và multi-worker concurrency. Không nối fixture identity vào runtime. Mọi hạng mục phải có kết quả kiểm thử cụ thể; chưa chạy thì ghi chưa chạy. Không merge hoặc deploy từ checklist này.
