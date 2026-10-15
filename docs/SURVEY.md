# Khảo sát Phase 0

Ngày khảo sát: 2026-10-15.

## Trạng thái repo

- URL: https://github.com/Anhtran88/Luna.zl-agent
- Repo public. `git ls-remote https://github.com/Anhtran88/Luna.zl-agent.git` trả về rỗng, exit 0. Không có ref, không có commit, không có README hay source.
- GitHub REST không dùng được từ môi trường này: unauthenticated request bị rate limit.
- `gh auth status`: chưa đăng nhập host nào.
- `GH_TOKEN` và `GITHUB_TOKEN` không được đặt.
- Không có `~/.ssh` hay credential helper để push.

## Workspace lúc bắt đầu

- Thư mục làm việc không phải git clone của Luna. Không có `.git`.
- Đã có khung web TanStack Start, React 19, Tailwind 4, Vitest không được dùng; test runner là `node:test`.
- Chưa có `src/routes`, `src/router.tsx`, `src/styles.css`.
- Không có secret Firebase, 9Router hay OpenAI trong môi trường.

## Giả định

- Luna Phase 0/1 là control plane, chưa phải connector Zalo hay eOffice.
- 9Router nghĩa là gateway OpenAI-compatible, base mặc định `http://127.0.0.1:20128/v1`, model id dạng `provider/model`, có alias và combo.
- Browser Use, Skyvern và Playwright chỉ cần interface ở phase này.
- Chủ repo sẽ quyết định credential, chi phí và hành động production trước các phase sau.

## Preview HTTP 500

Log dev server ghi nhiều `status: 500` lúc 2026-10-15 khoảng 09:47 UTC, cùng một nguyên nhân:

`SyntaxError: 'return' outside of function` tại `src/luna/server/functions.ts`, helper `readId` bị cắt tạm trong lúc sửa kiểu TypeScript. Vite SSR không biên dịch được route `/`, nên preview nhận 500.

Không phải lỗi Firebase, 9Router, browser hay credential. Sau khi khôi phục hàm, `GET /`, favicon, manifest và CSS đều trả 200. Không cần secret để hết lỗi này.

## Blocker

- Không tạo được branch trên GitHub, không push, không mở draft PR. Thiếu quyền ghi vào `Anhtran88/Luna.zl-agent`.
- Việc này không chặn bootstrap và test local.
