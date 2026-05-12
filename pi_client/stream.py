"""Raspberry Pi camera → JPEG → WebSocket → FastAPI backend."""
import asyncio
import os
import time
import cv2
import websockets

BACKEND_WS_URL = os.environ.get(
    "BACKEND_WS_URL",
    "wss://YOUR-CLOUDFLARE-TUNNEL.trycloudflare.com/ws/pi/pi-01?token=change-me",
)
TARGET_FPS = int(os.environ.get("TARGET_FPS", "15"))
WIDTH = int(os.environ.get("WIDTH", "640"))
HEIGHT = int(os.environ.get("HEIGHT", "360"))
JPEG_QUALITY = int(os.environ.get("JPEG_QUALITY", "70"))
USE_PICAM = os.environ.get("USE_PICAM", "0") == "1"


def open_camera():
    if USE_PICAM:
        from picamera2 import Picamera2
        cam = Picamera2()
        cam.configure(cam.create_video_configuration(main={"size": (WIDTH, HEIGHT)}))
        cam.start()
        return ("picam", cam)
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
    return ("cv2", cap)


async def stream():
    kind, cam = open_camera()
    interval = 1.0 / TARGET_FPS
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]

    print(f"[pi] connecting {BACKEND_WS_URL}")
    async with websockets.connect(BACKEND_WS_URL, max_size=8 * 1024 * 1024) as ws:
        print("[pi] connected")
        next_t = time.time()
        while True:
            now = time.time()
            if now < next_t:
                await asyncio.sleep(next_t - now)
            next_t = now + interval

            if kind == "picam":
                frame = cam.capture_array()
                frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            else:
                ok, frame = cam.read()
                if not ok:
                    continue

            ok, buf = cv2.imencode(".jpg", frame, encode_param)
            if not ok:
                continue
            await ws.send(buf.tobytes())
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=0.001)
                print("[pi]", msg[:200])
            except asyncio.TimeoutError:
                pass


if __name__ == "__main__":
    asyncio.run(stream())
