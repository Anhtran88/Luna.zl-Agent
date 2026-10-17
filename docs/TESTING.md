# Kiểm thử độc lập với nền tảng

`npm ci` rồi `npm test` là đường kiểm tra chuẩn. CI chạy cùng lệnh, tiếp theo build/typecheck/lint/security và UI E2E local. Không cần `.grok` hoặc credential. `config/app-env.json` tracked cung cấp mặc định public auth-off; config local rồi process env có thể override. Auth staging chưa được hoàn tất.

## Vì sao có bốn upstream contracts tùy chọn

`.grok/skills/og` thuộc bộ prompt/skill do nền tảng cung cấp, bị git-ignore và không được import để Luna chạy. Hai file sau trước đây đọc nó vô điều kiện:

| Test | File | Hành vi khi upstream vắng mặt |
| --- | --- | --- |
| upstream SKILL.md names the marker path and bound | `scripts/brand-check.test.mjs` | SKIP |
| upstream skill never affirms a brand-task wait | `scripts/brand-check.test.mjs` | SKIP |
| SKILL.md tells the pass to self-check with the flag this CLI accepts | `scripts/brand-check.test.mjs` | SKIP |
| every hand-over the og skill prints is one this script accepts | `scripts/write-atomic.test.mjs` | SKIP |

Kiểm tra marker, thời hạn và quy tắc không chờ trong `AGENTS.md` tracked vẫn chạy riêng. Mọi test chức năng của CLI, atomic writes, brand checks và app vẫn chạy. Regression tests chứng minh:

- Chỉ thư mục upstream hoàn toàn vắng và không được yêu cầu mới được skip.
- Thư mục chỉ có một phần hoặc đường dẫn được chỉ định nhưng thiếu phải fail; không tự skip.
- Child runner thực chạy các assertion và trả nonzero; tracked docs vẫn được kiểm.
- Không tạo `SKILL.md` giả hay thay assertion bằng kết quả cố định.

Với nguồn upstream thật:

```bash
LUNA_OG_SKILL_DIR=/path/to/upstream/og npm run test:upstream
```

`LUNA_REQUIRE_OG_SKILL=1` cũng buộc full suite kiểm nguồn mặc định. Chưa có nguồn thì bốn contract này fail ENOENT; đó là kết quả đúng của chế độ strict. Không gọi bốn SKIP là PASS. Số test mới được runner in ra; không dùng số cũ của PR làm bằng chứng.

## UI E2E

`agent-browser` được pin qua lockfile cho Node 22. Cần Chromium/Chrome có sẵn hoặc `AGENT_BROWSER_EXECUTABLE_PATH`. Khởi động lại dev server sau khi đổi dependencies.

```bash
npm run dev
# Trong terminal khác:
npm run test:e2e

# Sau build, kiểm riêng output đã build:
npm run build
npm run preview:restart
LUNA_E2E_URL=http://127.0.0.1:8081/ npm run test:e2e
```

Runner chỉ nhận `127.0.0.1:8080` hoặc `:8081`, không credential/query/path khác. Session, config và sockets riêng; không dùng profile hay saved auth của người dùng. Domain allowlist chặn resource ngoài loopback. Chrome chỉ lái UI local; browser adapter của Luna vẫn launch off.

Desktop/mobile đều kiểm duyệt, từ chối và hủy: sáu kịch bản cho dev, sáu cho built. Trạng thái task và audit ID phải khớp; dry-run trước approval/sau terminal bị disabled; approval không làm Firebase write được thực thi. Page errors, overflow hoặc thiếu audit làm runner fail. Failure cũng ghi verdict mới và snapshot/screenshot chẩn đoán; không dùng verdict cũ để báo pass. Artifacts synthetic ở thư mục screenshots ignored.

Form chỉ nhận thao tác sau khi React hydrate xong để nội dung nhập sớm không bị reset thành preset. Task đã hủy không còn hiện nút duyệt; backend từ chối cả approve/reject cho yêu cầu cũ và regression test kiểm chứng điều này.

Đây chưa phải auth/role, durable persistence, concurrency hay staging/live validation. Tất cả vẫn NO-GO.
