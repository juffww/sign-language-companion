"""Sliding-window inference pipeline."""
from __future__ import annotations
import asyncio
from collections import deque
from typing import Optional
import numpy as np
import cv2

from config import settings
from inference.model_loader import model, idx_to_word
from inference.features import make_holistic, extract_frame_features


class SignSession:
    """One per WebSocket client (Pi or browser)."""

    def __init__(self, seq_len: int = settings.SEQ_LEN):
        self.seq_len = seq_len
        self.buffer: deque[np.ndarray] = deque(maxlen=seq_len)
        self.holistic = make_holistic()
        self._last_pred: Optional[dict] = None

    def close(self):
        try:
            self.holistic.close()
        except Exception:
            pass

    async def push_jpeg(self, jpeg_bytes: bytes) -> Optional[dict]:
        """Decode JPEG → landmarks → feature; predict when buffer full."""
        arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return None
        h_cam, w_cam = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = self.holistic.process(rgb)
        feat = extract_frame_features(results, w_cam, h_cam)
        self.buffer.append(feat)

        if len(self.buffer) < self.seq_len:
            return {"status": "buffering", "filled": len(self.buffer), "need": self.seq_len}

        x = np.expand_dims(np.stack(self.buffer, axis=0), axis=0).astype(np.float32)
        # offload heavy predict to thread
        probs = await asyncio.to_thread(lambda: model.predict(x, verbose=0)[0])
        top_idx = np.argsort(probs)[::-1][:3]
        top3 = [{"word": idx_to_word.get(int(i), str(i)), "confidence": float(probs[i])} for i in top_idx]
        best = top3[0]
        out = {
            "status": "ok",
            "word": best["word"],
            "confidence": best["confidence"],
            "top3": top3,
            "accepted": best["confidence"] >= settings.MIN_CONFIDENCE,
        }
        self._last_pred = out
        return out
