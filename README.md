# Luna

Bảng điều khiển Luna. Phase 9 lập hồ sơ production và kết luận NO-GO. Firebase, 9Router và browser vẫn locked. Không deploy và không đăng nhập Zalo hay eOffice.

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
```

`production:check` luôn in NO-GO. Không gửi telemetry và không gọi mạng. Hồ sơ release: [docs/RELEASE.md](docs/RELEASE.md).

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

Nhánh `main` đã nhận [pull/3](https://github.com/Anhtran88/Luna.zl-Agent/pull/3). Phase 4 đến 8 vẫn là draft. Phase 9 làm trên `phase-9-production-readiness` và chưa merge. Hồ sơ release nằm ở [docs/RELEASE.md](docs/RELEASE.md). Không đưa token vào source hay `.env.example`.

## Preview HTTP 500

Một 500 trong lúc bootstrap là `SyntaxError: 'return' outside of function` khi `src/luna/server/functions.ts` đang sửa dở helper `readId`. File hiện đã kín. `GET /` phải trả 200 và title `Luna · Phase 0/1`. Lỗi không liên quan secret hay dịch vụ production.

## Không làm trong phase này

- Không automation production trên Zalo hoặc eOffice.
- Không đăng nhập, không gửi tin, không upload hay download dữ liệu người dùng.
- Không kết nối Firebase thật và không gọi `/v1/chat/completions`.
