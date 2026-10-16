# Luna

Bảng điều khiển Luna. Phase 12 thêm operational readiness local. Cờ xác nhận không phải sign-off. Production vẫn NO-GO. Firebase, 9Router và browser vẫn locked.

Repo đích: [Anhtran88/Luna.zl-agent](https://github.com/Anhtran88/Luna.zl-agent). Khảo sát ban đầu nằm ở [docs/SURVEY.md](docs/SURVEY.md). Kiến trúc nằm ở [ARCHITECTURE.md](ARCHITECTURE.md). Schema v1 nằm ở [docs/SCHEMA.md](docs/SCHEMA.md).

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
npm run deploy:dry-run
npm run security:check
npm run readiness
npm run staging:check
npm run production:check
npm run validate:sim
npm run governance:check
npm run ops:check
```

`ops:check` in NO-GO. Chủ repo gán mọi vai cho kenbi; đó là owner collision, không phải GO. License MIT. Staging chưa có. Browser và Zalo/eOffice bị cấm. Vận hành: [docs/OPERATIONS.md](docs/OPERATIONS.md). Quyết định: [config/readiness/owner-decisions.json](config/readiness/owner-decisions.json).

Biến môi trường chỉ là tên và placeholder. Xem [.env.example](.env.example). Không commit `.env`, service account, cookie hay API key.

## Phase 0/1 làm được gì

- Tạo tác vụ, planner tách executor, vòng đời nháp → kế hoạch → duyệt → dry-run.
- Model Router hiểu alias và combo kiểu 9Router, nhưng adapter đang chạy là mock.
- Browser Orchestrator đăng ký Playwright, Skyvern và Browser Use như stub. Mọi lệnh bị ép về mock.
- Firebase Realtime Database có port, adapter bộ nhớ và adapter live bị khóa.
- Bước nhạy cảm cần approval. Live bị từ chối dù đã duyệt.
- Phase 2: schema v1 cho task, approval, audit, run và settings. Store mặc định là bộ nhớ. REST Firebase chỉ chạy khi test tiêm transport.
- Model Router có registry, alias, timeout và retry. Retry không được gửi ra mạng. Chi phí mock là $0.

## GitHub

Remote chính thức: [Anhtran88/Luna.zl-Agent](https://github.com/Anhtran88/Luna.zl-Agent). URL cũ `Luna.zl-agent` redirect về đó.

Nhánh kiểm quyết định chủ repo là `phase-12-owner-decisions`. License là MIT. Copyright trong `LICENSE` dùng login GitHub `Anhtran88` vì profile không có tên pháp lý; chủ repo có thể thay bằng tên muốn hiển thị. Không đưa token vào source hay `.env.example`.

## Preview HTTP 500

Một 500 trong lúc bootstrap là `SyntaxError: 'return' outside of function` khi `src/luna/server/functions.ts` đang sửa dở helper `readId`. File hiện đã kín. `GET /` phải trả 200 và title `Luna · Phase 0/1`. Lỗi không liên quan secret hay dịch vụ production.

## Không làm trong phase này

- Không automation production trên Zalo hoặc eOffice.
- Không đăng nhập, không gửi tin, không upload hay download dữ liệu người dùng.
- Không kết nối Firebase thật và không gọi `/v1/chat/completions`.
