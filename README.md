# SignAI — Sign Language Recognition System (PBL5)

Hệ thống nhận diện & học ngôn ngữ ký hiệu end-to-end.

## Kiến trúc

- **Web app (repo này)**: React + TanStack Start, deploy qua Lovable
- **Backend AI**: FastAPI tự host — xem `docs/BACKEND_AND_PI.md`
- **Phần cứng**: Raspberry Pi 4 + Camera — xem `docs/BACKEND_AND_PI.md`
- **Database / Auth**: Lovable Cloud

## Tính năng web app

- Đăng ký / đăng nhập (email + password)
- `/live` — Live recognition qua webcam (hoặc Pi qua FastAPI)
- `/learn` — 100 từ vựng + practice có chấm điểm AI
- `/history` — Lịch sử phiên + dự đoán
- `/profile` — Thống kê cá nhân
- `/admin` — Dashboard cho admin (top từ, từ khó nhất)

## Cấu hình backend URL

Vào `/live` → bánh răng → dán URL FastAPI (cloudflared/ngrok). Lưu ở localStorage.

## Cấp quyền admin

Trong Lovable Cloud → Database → bảng `user_roles`, thêm row `{user_id: <uuid>, role: 'admin'}`.

## Chấm điểm theo Rubric PBL5

| Tiêu chí | Đáp ứng |
|---|---|
| 2a IoT | Pi → WS JPEG → FastAPI |
| 2b AI | BiLSTM + Bahdanau Attention, 100 từ |
| 2c Phần mềm | Web app full features + DB + Auth + Admin |
| Sáng tạo | Module học có AI chấm điểm tự động |

Chi tiết kỹ thuật xem `docs/BACKEND_AND_PI.md`.
