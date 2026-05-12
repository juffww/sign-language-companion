"""FastAPI entry point.

Endpoints:
  GET  /health                — liveness
  POST /predict               — single-shot: send 60 JPEG frames as multipart, get prediction
  WS   /ws/client             — browser webcam stream, JSON {type:'frame', jpeg_b64}
  WS   /ws/pi/{device_id}     — Pi raw JPEG binary frames
"""
from __future__ import annotations
import base64
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from inference.pipeline import SignSession

app = FastAPI(title="Sign Language Recognition API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "seq_len": settings.SEQ_LEN}


@app.post("/predict")
async def predict_batch(files: list[UploadFile] = File(...)):
    """Send N JPEG frames in order. Returns prediction once buffer is full."""
    if len(files) < settings.SEQ_LEN:
        raise HTTPException(400, f"need at least {settings.SEQ_LEN} frames, got {len(files)}")
    sess = SignSession()
    try:
        result = None
        for f in files[-settings.SEQ_LEN:]:
            data = await f.read()
            result = await sess.push_jpeg(data)
        return JSONResponse(result or {"status": "no_result"})
    finally:
        sess.close()


@app.websocket("/ws/client")
async def ws_client(ws: WebSocket):
    """Browser webcam: send {'type':'frame','jpeg_b64':'...'} per frame."""
    await ws.accept()
    sess = SignSession()
    try:
        while True:
            msg = await ws.receive_text()
            try:
                payload = json.loads(msg)
            except Exception:
                continue
            if payload.get("type") != "frame":
                continue
            jpeg = base64.b64decode(payload["jpeg_b64"])
            result = await sess.push_jpeg(jpeg)
            if result:
                await ws.send_json(result)
    except WebSocketDisconnect:
        pass
    finally:
        sess.close()


@app.websocket("/ws/pi/{device_id}")
async def ws_pi(ws: WebSocket, device_id: str, token: str = Query("")):
    """Raspberry Pi: raw JPEG bytes per message."""
    if settings.PI_SHARED_TOKEN and token != settings.PI_SHARED_TOKEN:
        await ws.close(code=4401)
        return
    await ws.accept()
    sess = SignSession()
    try:
        while True:
            jpeg = await ws.receive_bytes()
            result = await sess.push_jpeg(jpeg)
            if result:
                await ws.send_json({"device_id": device_id, **result})
    except WebSocketDisconnect:
        pass
    finally:
        sess.close()
