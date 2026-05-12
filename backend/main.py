"""FastAPI entry point — khớp flow record→predict của live_test_with_velocity.py.

Endpoints:
  GET  /health                  — liveness
  POST /predict                 — gửi N JPEG frames (multipart) → 1 prediction
  WS   /ws/client               — browser stream:
        client gửi {type:'frame', jpeg_b64} liên tục,
        khi muốn dự đoán → gửi {type:'predict'} hoặc {type:'reset'}
  WS   /ws/pi/{device_id}       — Pi raw JPEG bytes; gửi text 'predict' / 'reset' để điều khiển
"""
from __future__ import annotations
import base64
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from inference.pipeline import SignSession, MIN_FRAMES

app = FastAPI(title="Sign Language Recognition API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "min_frames": MIN_FRAMES}


@app.post("/predict")
async def predict_batch(files: list[UploadFile] = File(...)):
    """Gửi N JPEG frames theo thứ tự (N >= 8). Trả về 1 prediction."""
    if len(files) < MIN_FRAMES:
        raise HTTPException(400, f"need at least {MIN_FRAMES} frames, got {len(files)}")
    sess = SignSession()
    try:
        for f in files:
            data = await f.read()
            await sess.push_jpeg(data)
        result = await sess.predict()
        return JSONResponse(result)
    finally:
        sess.close()


@app.websocket("/ws/client")
async def ws_client(ws: WebSocket):
    await ws.accept()
    sess = SignSession()
    try:
        while True:
            msg = await ws.receive_text()
            try:
                payload = json.loads(msg)
            except Exception:
                continue
            t = payload.get("type")
            if t == "frame":
                jpeg = base64.b64decode(payload["jpeg_b64"])
                status = await sess.push_jpeg(jpeg)
                if status:
                    await ws.send_json(status)
            elif t == "predict":
                result = await sess.predict()
                await ws.send_json(result)
                sess.reset()
            elif t == "reset":
                sess.reset()
                await ws.send_json({"status": "reset"})
    except WebSocketDisconnect:
        pass
    finally:
        sess.close()


@app.websocket("/ws/pi/{device_id}")
async def ws_pi(ws: WebSocket, device_id: str, token: str = Query("")):
    if settings.PI_SHARED_TOKEN and token != settings.PI_SHARED_TOKEN:
        await ws.close(code=4401)
        return
    await ws.accept()
    sess = SignSession()
    try:
        while True:
            msg = await ws.receive()
            if "bytes" in msg and msg["bytes"] is not None:
                status = await sess.push_jpeg(msg["bytes"])
                if status:
                    await ws.send_json({"device_id": device_id, **status})
            elif "text" in msg and msg["text"]:
                cmd = msg["text"].strip().lower()
                if cmd == "predict":
                    result = await sess.predict()
                    await ws.send_json({"device_id": device_id, **result})
                    sess.reset()
                elif cmd == "reset":
                    sess.reset()
                    await ws.send_json({"device_id": device_id, "status": "reset"})
    except WebSocketDisconnect:
        pass
    finally:
        sess.close()
