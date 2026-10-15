# Luna

Bảng điều khiển Phase 0/1 cho agent Luna. Phase này dựng ranh giới module, cổng duyệt, dry-run và nhật ký. Không đăng nhập Zalo hay eOffice, không gửi tin, không ghi dữ liệu thật, không gọi model trả phí.

Repo đích: [Anhtran88/Luna.zl-agent](https://github.com/Anhtran88/Luna.zl-agent). Khảo sát ban đầu nằm ở [docs/SURVEY.md](docs/SURVEY.md). Kiến trúc nằm ở [ARCHITECTURE.md](ARCHITECTURE.md).

## Chạy local

```bash
npm install
npm run dev
```

Ứng dụng lắng nghe `0.0.0.0:8080`.

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Biến môi trường chỉ là tên và placeholder. Xem [.env.example](.env.example). Không commit `.env`, service account, cookie hay API key.

## Phase 0/1 làm được gì

- Tạo tác vụ, planner tách executor, vòng đời nháp → kế hoạch → duyệt → dry-run.
- Model Router hiểu alias và combo kiểu 9Router, nhưng adapter đang chạy là mock.
- Browser Orchestrator đăng ký Playwright, Skyvern và Browser Use như stub. Mọi lệnh bị ép về mock.
- Firebase Realtime Database có port, adapter bộ nhớ và adapter live bị khóa.
- Bước nhạy cảm cần approval. Live bị từ chối dù đã duyệt.

## GitHub

Remote [Anhtran88/Luna.zl-agent](https://github.com/Anhtran88/Luna.zl-agent) đang trống khi khảo sát. Branch local là `phase-0-1-bootstrap`. Máy này không push được: không có `GH_TOKEN` hay `GITHUB_TOKEN`, và `gh` chưa đăng nhập. Không nhét token vào repo hay `.env.example`.

Chủ repo xác thực `gh` hoặc cấp quyền ghi bên ngoài source, rồi tự push và mở draft PR vào `main`. Không merge từ phase này.

## Preview HTTP 500

Một 500 trong lúc bootstrap là `SyntaxError: 'return' outside of function` khi `src/luna/server/functions.ts` đang sửa dở helper `readId`. File hiện đã kín. `GET /` phải trả 200 và title `Luna · Phase 0/1`. Lỗi không liên quan secret hay dịch vụ production.

## Không làm trong phase này

- Không automation production trên Zalo hoặc eOffice.
- Không đăng nhập, không gửi tin, không upload hay download dữ liệu người dùng.
- Không kết nối Firebase thật và không gọi `/v1/chat/completions`.
