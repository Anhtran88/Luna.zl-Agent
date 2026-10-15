# An ninh Phase 6

Phase 6 siết an ninh local. Phase 7 không đổi các khóa đó và kết luận production là NO-GO. Xem [READINESS.md](READINESS.md).

## Threat model

| Mối đe doạ | Mức | Cách Phase 6 xử lý |
| --- | --- | --- |
| Secret, private key, token hoặc cookie bị commit | Critical | `security:check` báo rule và đường dẫn, không in giá trị. Dry-run fail. |
| Firebase rules mở public read/write | High | Rules mẫu deny-all, kể cả nhánh `luna`. Không deploy. |
| Bật Firebase live, 9Router live, browser thật hoặc production | High | Gate luôn trả `false`. UI không có nút tắt khóa. |
| Endpoint production bị gọi nhầm | High | URL không loopback bị từ chối và không được fetch. |
| Lỗi hoặc audit làm lộ secret | Medium | Message công khai và audit bị redact, cắt độ dài. |
| Lạm dụng API local | Low | Rate-limit trong tiến trình. Không gọi dịch vụ ngoài. |
| Preview bị nhúng iframe | Info | Không đặt `X-Frame-Options` hay `frame-ancestors`, vì bảng điều khiển chạy trong preview. |

`npm audit --omit=dev` tại thời điểm Phase 6 không có lỗ hổng production.

## Trust boundaries

- Trình duyệt chỉ gửi mục tiêu tác vụ đã được kiểm tra độ dài và loại credential.
- Server function không nhận `mode: live`, không bật browser, không bật production.
- Store mặc định là bộ nhớ trong tiến trình.
- Firebase URL `lunazl-agent` chỉ là toạ độ công khai. Không có socket.
- Deploy CLI không đọc `.env` và không publish.
- Cookie session thuộc nền tảng (`__Host-`, Secure, SameSite Lax). Luna không tạo cookie mới và không ghi giá trị cookie vào log.

## Header

`X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` tắt camera/micro/vị trí/thanh toán, CSP chỉ `base-uri 'self'; object-src 'none'`. Không khoá script hay frame, để dev server, font và preview còn chạy.

## Sự cố và rollback

1. Nếu scanner báo secret, không copy giá trị vào chat, issue hay file mới.
2. Gỡ khỏi working tree. Việc xoá history cần chủ repo quyết định.
3. Không deploy rules để "vá". Rules trên console không được đụng.
4. Rollback deployment vẫn là `local-no-op`: không đổi process đang chạy, không gọi hosting.
5. Live action bị chặn vẫn chỉ ghi audit dry-run, không có credential.

## Giới hạn

- Chưa có WAF, CSP script-src, hay rate-limit bên ngoài.
- Chưa khoá iframe vì preview.
- Chưa đổi cookie của nền tảng auth.
- Staging có mạng và production vẫn cần chủ repo xác nhận trước.
- Zalo và eOffice không nằm trong phase này.
