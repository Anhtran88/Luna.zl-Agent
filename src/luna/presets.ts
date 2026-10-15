export const TASK_PRESETS = [
  {
    id: "summary",
    label: "Tóm tắt mock",
    goal: "Tóm tắt kiến trúc Phase 0/1 bằng model mock, không gọi mạng.",
  },
  {
    id: "queue",
    label: "Đọc Firebase nhớ",
    goal: "Đọc hàng đợi tác vụ từ Firebase realtime bộ nhớ, không ghi dữ liệu thật.",
  },
  {
    id: "browser",
    label: "Trình duyệt mock",
    goal: "Mô phỏng Playwright cho một trang công khai.",
  },
  {
    id: "zalo",
    label: "Zalo bị khóa",
    goal: "Đăng nhập Zalo và gửi tin nhắn cho nhóm vận hành.",
  },
] as const;
