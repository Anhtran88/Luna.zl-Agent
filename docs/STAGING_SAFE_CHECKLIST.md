# Checklist staging-safe local

Luna chưa hoàn thiện ở mức staging-safe. Checklist này không cấp quyền staging/live/deploy; production vẫn NO-GO. Không dùng dữ liệu thật, URL staging, credential hay storage root cá nhân trong repo.

| Ưu tiên | Nhóm | Đã có trong repo | Còn thiếu để đánh giá hoàn thiện |
| --- | --- | --- | --- |
| P0 đã đóng | Test reproducibility | `npm ci` + `npm test` chạy từ source sạch không có `.grok`. Tracked config giữ auth-off; bốn upstream OG contracts skip rõ lý do, `test:upstream` bắt buộc và fail khi thiếu/sai nguồn. CI chạy toàn suite và E2E. | Nếu cần xác minh prompt nền tảng, cung cấp nguồn upstream thật theo [TESTING.md](TESTING.md); không tạo fixture giả. |
| P0 | Auth/roles | Auth có sẵn trong template nhưng local mặc định off; owner collision bị chặn. | Định nghĩa identity và quyền requester/approver cho staging. Viết test local cho truy cập không được phép, tự duyệt và cách ly người dùng trước khi xét mở quyền truy cập từ xa. Không tự bật auth/live. |
| P1 luồng cơ bản đã có | Task + approval + audit | E2E UI local tạo → plan → approve → dry-run → audit; nhánh reject/cancel không execute. Audit được đối chiếu đúng task ID, write Firebase vẫn refused. | Kiểm replay/concurrency và restart mất dữ liệu memory. Không coi memory là persistence staging. |
| P1 | UI/flows | E2E dev/built trên desktop/mobile, 12 kịch bản, kiểm disabled trước approval/sau terminal, không overflow, không uncaught app error; giữ NO-GO. | Bổ sung UX lỗi/loading, reload/retry và thử lỗi transport local có kiểm soát. |
| P1 | Adapter contracts | Firebase factory khóa dù có token/transport; REST test chỉ loopback. 9Router mock, browser stub; Zalo/eOffice chỉ mô phỏng đúng scope. | Giữ contract tests âm trên mọi đường đọc/ghi và chứng minh không gọi transport ngoài; contract mô phỏng không chứng minh dịch vụ thật sẵn sàng. |
| P1 | Proof/governance | Evidence có digest/hạn/scope/ref; cờ `true` không đóng sign-off; cap $1/dịch vụ giữ nguyên. | Bằng chứng thực và bảy vai độc lập vẫn thiếu; health/alerting không được giả lập thành proof production. Hạng mục này giữ BLOCKED, không điền hộ hay bật cổng. |

Hạng mục local tiếp theo: auth/role contract và test từ chối trước khi xét staging; sau đó replay/concurrency và lỗi/retry trong UI với dữ liệu tổng hợp. Mọi hạng mục phải có kết quả kiểm thử cụ thể; chưa chạy thì ghi chưa chạy. Không merge hoặc deploy từ checklist này.
