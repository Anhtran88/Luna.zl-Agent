# Luna

Bảng điều khiển Luna. Phase 12 thêm operational readiness local. Cờ xác nhận không phải sign-off. Production vẫn NO-GO. Firebase, 9Router và browser vẫn locked.

Repo đích: [Anhtran88/Luna.zl-agent](https://github.com/Anhtran88/Luna.zl-agent). Khảo sát ban đầu nằm ở [docs/SURVEY.md](docs/SURVEY.md). Kiến trúc nằm ở [ARCHITECTURE.md](ARCHITECTURE.md). Schema v1 nằm ở [docs/SCHEMA.md](docs/SCHEMA.md).

## Chạy local

```bash
npm ci
npm run dev
```

Ứng dụng lắng nghe `0.0.0.0:8080`.

```bash
npm test
npm run build
npm run lint
npm run typecheck
npm run deploy:dry-run
npm run security:check
npm run readiness
npm run staging:check
npm run production:check
npm run validate:sim
npm run governance:check
npm run ops:check
```

`ops:check` in NO-GO. Chủ repo gán mọi vai cho kenbi; đó là owner collision, không phải GO. License MIT. Cap tháng mỗi dịch vụ là 1 USD và lần này chi 0. Staging logic tên luna-staging, chưa verified. Browser launch tắt. Zalo và eOffice chỉ là policy mô phỏng. Tên PDF giao nhận là `P.GIAO_[VATTU]_[dd.mm.yyyy]_[DUAN].pdf`; mã dự án chỉ SUN, HOL hoặc GRC, mã khác thì hỏi. Lần này không ghi file và storage root để trống. Vận hành: [docs/OPERATIONS.md](docs/OPERATIONS.md). Quyết định: [config/readiness/owner-decisions.json](config/readiness/owner-decisions.json).

Biến môi trường chỉ là tên và placeholder. Xem [.env.example](.env.example). Không commit `.env`, service account, cookie hay API key.

## Kiểm thử tái lập

Staging RTDB dùng binding riêng; approve/execute HTTP hiện fail-closed vì chưa có trusted auth/roles và owner authorization. Xem [local auth/state contract và staging wiring](docs/LOCAL_AUTH_STATE_CONTRACT.md). Không bật kết nối thật chỉ bằng cách điền URL hoặc live flag.

`npm ci` rồi `npm test` chạy cả scripts và app tests. Số test được in bởi runner; không giữ số cố định của phase cũ làm tiêu chí. Bốn contract tests của tài liệu OG upstream sẽ ghi **SKIP** khi `.grok/skills/og` không được cung cấp. Đây là prompt của nền tảng bị git-ignore, không phải source cần để Luna chạy. Các kiểm tra `AGENTS.md` tracked và mọi kiểm tra chức năng vẫn chạy. Không tạo tài liệu giả để làm xanh.

Để kiểm contract với nguồn upstream thật: `LUNA_OG_SKILL_DIR=/path/to/upstream/og npm run test:upstream`. Chế độ này bắt buộc tài liệu; thiếu/sai nội dung phải fail. Thư mục skill chỉ có một phần cũng không được tự skip. `config/app-env.json` cung cấp mặc định public auth-off cho checkout sạch; `.grok/app-env.json` tùy chọn và biến process vẫn có quyền override. Đây không phải cấu hình auth staging.

## UI E2E local

CLI `agent-browser` được pin trong dev dependencies, dùng Chromium cài sẵn hoặc `AGENT_BROWSER_EXECUTABLE_PATH`. Khi dev server đang chạy, dùng `npm run test:e2e`. Sau `npm run build` và `npm run preview:restart`, chạy `LUNA_E2E_URL=http://127.0.0.1:8081/ npm run test:e2e`.

Runner kiểm desktop/mobile cho create → plan → approve/reject/execute bị deny khi chưa có trusted auth → cancel → audit/reload. Không tạo success audit hoặc đổi task từ lệnh bị deny. Core simulation kiểm happy dry-run riêng, Firebase write vẫn refused. Chỉ nhận loopback dev/built, chặn resource ngoài domain local, dùng session mới và đóng browser sau test. Browser này chỉ kiểm UI local; adapter browser của Luna vẫn mock/stub, launch off. Artifacts ở `screenshots/e2e-*` (cloud: `/workspace/screenshots/e2e-*`), không commit. CI chạy toàn bộ `npm test` và E2E dev/built.

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
