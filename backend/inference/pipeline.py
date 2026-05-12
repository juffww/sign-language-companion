"""Sliding-window inference pipeline — khớp live_test_with_velocity.py."""
from __future__ import annotations
import asyncio
from typing import Optional
import numpy as np
import cv2

from config import settings
from inference.model_loader import model, idx_to_word, SEQ_LEN
from inference.features import make_holistic, extract_frame_features, preprocess_sequence

MIN_FRAMES = 8  # tối thiểu để resample (giống live_test)


class SignSession:
    """Mỗi WS client / mỗi /predict request = 1 instance."""

    def __init__(self):
        self.frames: list[np.ndarray] = []
        self.holistic = make_holistic()

    def close(self):
        try:
            self.holistic.close()
        except Exception:
            pass

    def _process_frame(self, jpeg_bytes: bytes) -> Optional[tuple[int, int]]:
        arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return None
        h_cam, w_cam = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = self.holistic.process(rgb)
        feat = extract_frame_features(results, float(w_cam), float(h_cam))
        self.frames.append(feat)
        return (w_cam, h_cam)

    async def push_jpeg(self, jpeg_bytes: bytes) -> Optional[dict]:
        """Streaming: chỉ tích lũy. Caller gọi predict() khi muốn ra kết quả."""
        ok = await asyncio.to_thread(self._process_frame, jpeg_bytes)
        if ok is None:
            return None
        return {"status": "buffering", "filled": len(self.frames)}

    async def predict(self) -> dict:
        if len(self.frames) < MIN_FRAMES:
            return {"status": "not_enough_frames", "filled": len(self.frames), "need": MIN_FRAMES}
        x = await asyncio.to_thread(preprocess_sequence, self.frames, SEQ_LEN)
        probs, _attn = await asyncio.to_thread(lambda: model.predict(x, verbose=0))
        probs = probs[0]
        top_idx = np.argsort(probs)[::-1][:3]
        top3 = [{"word": idx_to_word.get(int(i), str(i)), "confidence": float(probs[i])} for i in top_idx]
        best = top3[0]
        return {
            "status": "ok",
            "word": best["word"],
            "confidence": best["confidence"],
            "top3": top3,
            "accepted": best["confidence"] >= settings.MIN_CONFIDENCE,
            "frames_used": len(self.frames),
        }

    def reset(self):
        self.frames.clear()
