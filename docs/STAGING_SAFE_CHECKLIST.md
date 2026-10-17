# Checklist staging-safe local

Luna chưa hoàn thiện ở mức staging-safe. Checklist này không cấp quyền staging/live/deploy; production vẫn NO-GO. Không dùng dữ liệu thật, URL staging, credential hay storage root cá nhân trong repo.

| Ưu tiên | Nhóm | Đã có trong repo | Còn thiếu để đánh giá hoàn thiện |
| --- | --- | --- | --- |
| P0 | Docs/CI | CI chạy app tests, build, typecheck, lint, security và dry-run. | Làm `npm test` tái lập từ checkout sạch: bốn test tài liệu template đang thiếu `.grok/skills/og`. Cần nguồn tài liệu thật hoặc tách rõ contract test nền tảng; không tạo fixture giả để báo pass. |
| P0 | Auth/roles | Auth có sẵn trong template nhưng local mặc định off; owner collision bị chặn. | Định nghĩa identity và quyền requester/approver cho staging. Viết test local cho truy cập không được phép, tự duyệt và cách ly người dùng trước khi xét mở quyền truy cập từ xa. Không tự bật auth/live. |
| P1 | Task + approval + audit | Có test lifecycle dry-run, approval, cancel, terminal state, store memory và redaction. | Thêm E2E local từ UI qua server cho tạo → lập kế hoạch → duyệt/từ chối → dry-run → audit; kiểm replay/concurrency và restart mất dữ liệu memory. Không coi memory là persistence staging. |
| P1 | UI/flows | Dashboard hiển thị NO-GO và trạng thái khóa; build/typecheck là gate. | Kiểm desktop/mobile và thao tác thật trên UI local ở cả dev/built output, gồm lỗi, loading, từ chối và hủy. Unit/integration tests không thay thế browser E2E. |
| P1 | Adapter contracts | Firebase factory khóa dù có token/transport; REST test chỉ loopback. 9Router mock, browser stub; Zalo/eOffice chỉ mô phỏng đúng scope. | Giữ contract tests âm trên mọi đường đọc/ghi và chứng minh không gọi transport ngoài; contract mô phỏng không chứng minh dịch vụ thật sẵn sàng. |
| P1 | Proof/governance | Evidence có digest/hạn/scope/ref; cờ `true` không đóng sign-off; cap $1/dịch vụ giữ nguyên. | Bằng chứng thực và bảy vai độc lập vẫn thiếu; health/alerting không được giả lập thành proof production. Hạng mục này giữ BLOCKED, không điền hộ hay bật cổng. |

Hạng mục local tiếp theo: sửa tính tái lập của bộ test tài liệu P0, sau đó E2E task/approval/audit P1 với dữ liệu tổng hợp. Mọi hạng mục phải có kết quả kiểm thử cụ thể; chưa chạy thì ghi chưa chạy. Không merge hoặc deploy từ checklist này.
