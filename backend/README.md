# Sign Language FastAPI Backend

## Setup (laptop, không Docker)

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
mkdir -p models
# copy 3 file vào ./models/
#   best_model.keras
#   meta.json
#   100_index_mapping.json
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Test: http://localhost:8000/health

## Setup (Docker — khuyến nghị)

```bash
cd backend
cp .env.example .env
mkdir -p models     # copy model files vào đây
docker compose up --build
```

## Expose ra Internet (cho web app + Pi gọi)

Cài cloudflared rồi:

```bash
cloudflared tunnel --url http://localhost:8000
```

Sẽ in ra URL dạng `https://xxxx.trycloudflare.com`. Paste URL đó vào
biến `VITE_FASTAPI_URL` của frontend (file `.env` ở root).

## QUAN TRỌNG: chỉnh feature extractor

Mở `inference/features.py` và sửa `extract_frame_features` để khớp **đúng**
với layout vector bạn đã train (cùng số chiều, cùng thứ tự pose/face/hand,
có/không velocity). FEATURE_DIM phải bằng `model.input_shape[-1]`.

Nếu model bạn train có velocity (nối thêm Δlandmark giữa các frame), thêm
logic đó vào trong `pipeline.SignSession.push_jpeg` trước khi append vào buffer.
