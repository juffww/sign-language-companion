"""Extract MediaPipe holistic landmarks → feature vector.

Adapted from your live_test_with_velocity.py.
Replace the body of `extract_frame_features` with the EXACT logic you trained on.
"""
from __future__ import annotations
import numpy as np
import mediapipe as mp

mp_holistic = mp.solutions.holistic


def make_holistic():
    """Each WS connection / each request gets its own instance (not thread-safe)."""
    return mp_holistic.Holistic(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )


def _flatten_landmarks(landmarks, n_points: int, has_visibility: bool, w_cam: int, h_cam: int) -> np.ndarray:
    """Return a flat (n_points * dims,) vector. dims=4 if has_visibility else 3."""
    dims = 4 if has_visibility else 3
    out = np.zeros((n_points, dims), dtype=np.float32)
    if landmarks is None:
        return out.flatten()
    for i, lm in enumerate(landmarks.landmark[:n_points]):
        if has_visibility:
            out[i] = [lm.x, lm.y, lm.z, getattr(lm, "visibility", 0.0)]
        else:
            out[i] = [lm.x, lm.y, lm.z]
    return out.flatten()


def extract_frame_features(results, w_cam: int, h_cam: int) -> np.ndarray:
    """Return single-frame feature vector, length = FEATURE_DIM.

    Default layout (matches the common BiLSTM+Attention sign-language setup):
      pose 33 * 4   = 132
      face 468 * 3  = 1404   (set to zeros if you didn't train on face)
      lhand 21 * 3  =  63
      rhand 21 * 3  =  63
      TOTAL         = 1662   (or 258 if face dropped)

    >>> ADJUST THIS to match your trained FEATURE_DIM (e.g. 438) <<<
    """
    pose = _flatten_landmarks(results.pose_landmarks, 33, True, w_cam, h_cam)
    lh = _flatten_landmarks(results.left_hand_landmarks, 21, False, w_cam, h_cam)
    rh = _flatten_landmarks(results.right_hand_landmarks, 21, False, w_cam, h_cam)
    # Drop face by default — re-enable if your model uses it:
    # face = _flatten_landmarks(results.face_landmarks, 468, False, w_cam, h_cam)
    # return np.concatenate([pose, face, lh, rh])
    return np.concatenate([pose, lh, rh])
