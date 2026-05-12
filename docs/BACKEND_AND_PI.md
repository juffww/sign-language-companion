# SignAI — Backend (FastAPI) + Raspberry Pi

> Toàn bộ code phần cứng + AI inference. **Chạy ngoài Lovable**, kết nối tới web app qua HTTPS public URL (cloudflared/ngrok).

## Kiến trúc

```
Pi Camera ──WS(JPEG)──▶ FastAPI ──▶ MediaPipe + BiLSTM ──▶ Web app (REST/WS)
```

- Web app: React (đã build trong Lovable, deploy `*.lovable.app`)
- Backend AI: FastAPI tự host (laptop/PC) + cloudflared tunnel
- Database / Auth: Lovable Cloud (Supabase)

---

## 1. Backend FastAPI

### Cấu trúc

```
backend/
├── main.py
├── inference/
│   ├── __init__.py
│   ├── model_loader.py     # PadMask, BahdanauAttention, build_model
│   ├── features.py         # extract_frame_features
│   └── velocity.py         # add_arm_hand_velocity_features, preprocess_sequence
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── models/                 # đặt model ở đây
    ├── bilstm_attention.keras
    ├── model_meta.json
    └── 100_index_mapping.json
```

### `requirements.txt`

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
python-multipart==0.0.9
numpy==1.26.4
opencv-python-headless==4.10.0.84
mediapipe==0.10.14
tensorflow==2.16.1
pydantic==2.9.0
```

### `inference/model_loader.py`

Sao y các class `PadMask`, `BahdanauAttention`, hàm `build_model(...)` và đoạn load weights từ `live_test_with_velocity.py` (lines 32-70 và 372-433). Wrap trong:

```python
import json, zipfile, tempfile, os
import tensorflow as tf
from .model_loader_helpers import PadMask, BahdanauAttention, build_model

class ModelService:
    def __init__(self, model_path: str, meta_path: str, labels_path: str):
        with open(meta_path) as f: self.meta = json.load(f)
        with open(labels_path) as f:
            self.labels = {int(k): v for k, v in json.load(f).items()}

        self.model = build_model(
            seq_len=self.meta['seq_len'],
            input_dim=self.meta['input_dim'],
            hidden_dim=self.meta['hidden_dim'],
            num_layers=self.meta['num_layers'],
            attn_dim=self.meta['attn_dim'],
            num_classes=len(self.labels),
            dropout=self.meta['dropout'],
        )
        with zipfile.ZipFile(model_path, 'r') as z:
            tmp = tempfile.mkdtemp()
            z.extract('model.weights.h5', tmp)
        self.model.load_weights(os.path.join(tmp, 'model.weights.h5'))

        # Pre-warm
        import numpy as np
        dummy = np.zeros((1, self.meta['seq_len'], 612), dtype=np.float32)
        self.model.predict(dummy, verbose=0)

    def predict(self, x):  # x shape (1, seq_len, 612)
        probs, _ = self.model.predict(x, verbose=0)
        top = probs[0].argsort()[-3:][::-1]
        return {
            "word": self.labels[int(top[0])],
            "conf": float(probs[0][top[0]]) * 100,
            "top3": [[self.labels[int(i)], float(probs[0][i]) * 100] for i in top],
        }
```

### `inference/features.py`

Copy nguyên `FACE_SELECTED` và `extract_frame_features` từ `live_test_with_velocity.py` lines 82-193. **Chỉnh nhỏ**: nhận thêm `w_cam, h_cam` thay vì hardcode 1280×720 — vì web/Pi gửi frame 640×360. Thực ra normalize chỉ phụ thuộc vai, nên giữ nguyên 1280×720 cũng OK; nhưng tốt nhất là parametrize:

```python
def extract_frame_features(results, w_cam: float = 1280.0, h_cam: float = 720.0) -> np.ndarray:
    # ... (toàn bộ logic gốc, thay 1280.0 / 720.0 bằng w_cam/h_cam)
```

### `inference/velocity.py`

Copy nguyên `add_arm_hand_velocity_features` và `preprocess_sequence` từ lines 201-243.

### `main.py`

```python
import asyncio
import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import mediapipe as mp

from inference.model_loader import ModelService
from inference.features import extract_frame_features
from inference.velocity import preprocess_sequence

app = FastAPI(title="SignAI Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],         # production: liệt kê domain web
    allow_methods=["*"],
    allow_headers=["*"],
)

model = ModelService(
    "models/bilstm_attention.keras",
    "models/model_meta.json",
    "models/100_index_mapping.json",
)
SEQ_LEN = model.meta["seq_len"]

mp_holistic = mp.solutions.holistic

def make_holistic():
    return mp_holistic.Holistic(
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
        model_complexity=1,
    )

# Một instance Holistic / request (Mediapipe không thread-safe)
@app.post("/api/predict")
async def predict(frames: list[UploadFile] = File(...)):
    """Web app gửi N frames JPEG → backend trả {word, conf, top3}."""
    if len(frames) < 8:
        raise HTTPException(400, "Cần ít nhất 8 frame")

    holistic = make_holistic()
    feats = []
    for f in frames:
        data = await f.read()
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            continue
        h, w = img.shape[:2]
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = holistic.process(rgb)
        feats.append(extract_frame_features(results, float(w), float(h)))
    holistic.close()

    if len(feats) < 8:
        raise HTTPException(400, "Không đủ frame hợp lệ")

    x = preprocess_sequence(feats, SEQ_LEN)  # (1, SEQ_LEN, 612)
    return await asyncio.to_thread(model.predict, x)


# ──────────── WebSocket cho Pi ────────────
# Pi gửi binary JPEG → server buffer SEQ_LEN frames, predict, broadcast tới web client
PI_BUFFERS: dict[str, list] = {}
PI_HOLISTIC: dict[str, any] = {}
WEB_CLIENTS: dict[str, set[WebSocket]] = {}

@app.websocket("/ws/pi/{device_id}")
async def ws_pi(ws: WebSocket, device_id: str):
    await ws.accept()
    PI_BUFFERS[device_id] = []
    PI_HOLISTIC[device_id] = make_holistic()
    try:
        while True:
            data = await ws.receive_bytes()
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if img is None: continue
            h, w = img.shape[:2]
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False
            results = PI_HOLISTIC[device_id].process(rgb)
            feat = extract_frame_features(results, float(w), float(h))
            PI_BUFFERS[device_id].append(feat)
            if len(PI_BUFFERS[device_id]) >= SEQ_LEN:
                window = PI_BUFFERS[device_id][-SEQ_LEN:]
                x = preprocess_sequence(window, SEQ_LEN)
                pred = await asyncio.to_thread(model.predict, x)
                # gửi cho mọi web client đang xem device_id này
                for client in WEB_CLIENTS.get(device_id, set()):
                    try: await client.send_json(pred)
                    except: pass
                # trượt 1/2 cửa sổ
                PI_BUFFERS[device_id] = PI_BUFFERS[device_id][SEQ_LEN // 2:]
    except WebSocketDisconnect:
        PI_HOLISTIC[device_id].close()
        PI_BUFFERS.pop(device_id, None)
        PI_HOLISTIC.pop(device_id, None)


@app.websocket("/ws/client/{device_id}")
async def ws_client(ws: WebSocket, device_id: str):
    await ws.accept()
    WEB_CLIENTS.setdefault(device_id, set()).add(ws)
    try:
        while True:
            await ws.receive_text()  # ping/pong
    except WebSocketDisconnect:
        WEB_CLIENTS.get(device_id, set()).discard(ws)


@app.get("/health")
def health():
    return {"ok": True, "seq_len": SEQ_LEN, "classes": len(model.labels)}
```

### `Dockerfile`

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### `docker-compose.yml`

```yaml
services:
  api:
    build: .
    ports: ["8000:8000"]
    volumes: ["./models:/app/models:ro"]
    restart: unless-stopped
```

### Chạy

```bash
cd backend
docker compose up -d
# Expose ra Internet (miễn phí, không cần card credit):
cloudflared tunnel --url http://localhost:8000
# → in ra https://xxx-yyy.trycloudflare.com  (copy URL này)
```

Vào web app → trang Live → nút bánh răng → dán URL → Lưu.

---

## 2. Raspberry Pi Client

### `pi-client/stream.py`

```python
import asyncio, websockets, cv2, time, sys, signal

WS_URL    = "wss://xxx-yyy.trycloudflare.com/ws/pi/pi-001"
DEVICE_ID = "pi-001"
FPS       = 15
WIDTH     = 640
HEIGHT    = 360
JPEG_Q    = 70

async def stream():
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
    interval = 1.0 / FPS

    while True:
        try:
            print(f"Connecting {WS_URL}...")
            async with websockets.connect(WS_URL, max_size=2**24) as ws:
                print("Connected")
                while True:
                    t0 = time.time()
                    ok, frame = cap.read()
                    if not ok:
                        await asyncio.sleep(0.1); continue
                    ok, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_Q])
                    if not ok: continue
                    await ws.send(buf.tobytes())
                    dt = time.time() - t0
                    if dt < interval: await asyncio.sleep(interval - dt)
        except Exception as e:
            print(f"WS error: {e}; reconnect in 3s")
            await asyncio.sleep(3)

if __name__ == "__main__":
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    asyncio.run(stream())
```

### Cài đặt trên Pi

```bash
sudo apt update && sudo apt install -y python3-pip python3-opencv
pip3 install websockets
python3 stream.py
```

### Auto-start (systemd)

`/etc/systemd/system/sign-stream.service`:

```ini
[Unit]
Description=SignAI Pi Stream
After=network-online.target

[Service]
ExecStart=/usr/bin/python3 /home/pi/sign/stream.py
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now sign-stream
sudo systemctl status sign-stream
```

---

## 3. Hướng dẫn chỉnh sửa `live_test_with_velocity.py` để khớp pipeline

Thay đổi duy nhất: **`extract_frame_features` nhận `w_cam, h_cam` làm tham số**, vì frame từ web (640×360) khác frame demo OpenCV (1280×720). Đoạn code:

```python
# TRƯỚC
W_cam, H_cam = 1280.0, 720.0

# SAU
def extract_frame_features(results, w_cam: float = 1280.0, h_cam: float = 720.0):
    ...
    W_cam, H_cam = w_cam, h_cam
    ...
```

Tất cả phần còn lại (Velocity, BahdanauAttention, build_model, load weights) giữ nguyên.

---

## 4. Demo flow PBL5

1. `docker compose up -d` + `cloudflared tunnel`
2. Bật Pi (`systemctl start sign-stream`)
3. Mở web app, đăng nhập, vào `/live` → dán cloudflared URL
4. Bấm camera (webcam) hoặc xem stream Pi → ký hiệu → web hiển thị từ + confidence
5. Vào `/learn/<word>` → ký hiệu → app chấm "Đúng / Sai"
6. Vào `/admin` → xem leaderboard từ + accuracy

---

## 5. Outline báo cáo & slide

**Báo cáo (gợi ý 30-40 trang):**
1. Mở đầu, đặt vấn đề, nhu cầu cộng đồng khiếm thính VN
2. Khảo sát: Sign Language Recognition, datasets (WLASL, Kareem 100), MediaPipe Holistic
3. Thiết kế hệ thống: kiến trúc 3 lớp (IoT - AI - App)
4. Thuật toán: pipeline 438 features → 612 (velocity) → BiLSTM 2 lớp → Bahdanau Attention → Softmax 100
5. Triển khai phần cứng: Pi + Camera + WS streaming
6. Triển khai phần mềm: FastAPI + React + Lovable Cloud
7. Kết quả: accuracy/F1 trên test set, latency end-to-end
8. Đánh giá, hạn chế, hướng phát triển (mở rộng từ vựng, ngữ cảnh câu)

**Slide demo (10-12 slide):**
1. Title  2. Vấn đề  3. Giải pháp tổng quan  4. Kiến trúc
5. Pipeline AI  6. Demo Live (video)  7. Module học (video)
8. Admin dashboard  9. Kết quả & metrics  10. Hạn chế & hướng phát triển  11. Q&A
