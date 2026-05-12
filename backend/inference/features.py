"""Trích xuất landmarks giống HỆT live_test_with_velocity.py
Mỗi frame = 438 features:
  [0:132]   pose 33 × 4 (x,y,z,visibility)  — chỉ giữ vai+tay (lm 11-16)
  [132:312] face 60 × 3
  [312:375] left  hand 21 × 3
  [375:438] right hand 21 × 3
Sau đó normalize quanh tâm vai theo pixel (W=1280, H=720).
"""
from __future__ import annotations
import numpy as np
import mediapipe as mp

mp_holistic = mp.solutions.holistic

FACE_SELECTED = [
    33, 160, 158, 133, 153, 144,
    362, 385, 387, 263, 373, 380,
    70, 63, 105,
    336, 296, 334,
    1, 2, 5, 4,
    98, 97, 327,
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 146,
    78, 191, 80, 81, 82, 312, 311, 310,
    10, 338, 297, 332, 284, 251, 389, 356,
    454, 323, 361, 288, 397, 365, 379,
]
assert len(FACE_SELECTED) == 60


def make_holistic():
    return mp_holistic.Holistic(
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
        model_complexity=1,
    )


def extract_frame_features(results, w_cam: float = 1280.0, h_cam: float = 720.0) -> np.ndarray:
    frame = np.zeros(438, dtype=np.float32)

    if results.pose_landmarks:
        for i, lm in enumerate(results.pose_landmarks.landmark):
            base = i * 4
            frame[base] = lm.x
            frame[base + 1] = lm.y
            frame[base + 2] = lm.z
            frame[base + 3] = lm.visibility

    if results.face_landmarks:
        lms = results.face_landmarks.landmark
        for j, idx in enumerate(FACE_SELECTED):
            lm = lms[idx]
            base = 132 + j * 3
            frame[base] = lm.x
            frame[base + 1] = lm.y
            frame[base + 2] = lm.z

    if results.left_hand_landmarks:
        for i, lm in enumerate(results.left_hand_landmarks.landmark):
            base = 312 + i * 3
            frame[base] = lm.x
            frame[base + 1] = lm.y
            frame[base + 2] = lm.z

    if results.right_hand_landmarks:
        for i, lm in enumerate(results.right_hand_landmarks.landmark):
            base = 375 + i * 3
            frame[base] = lm.x
            frame[base + 1] = lm.y
            frame[base + 2] = lm.z

    # Mask: chỉ giữ pose lm 11-16 (vai + cánh tay)
    pose_keep = {11, 12, 13, 14, 15, 16}
    for i in range(33):
        if i not in pose_keep:
            frame[i * 4: i * 4 + 4] = 0.0

    # Normalize theo tâm vai (pixel)
    pose = frame[0:132].reshape(33, 4)
    left_sh = pose[11, :2].copy(); left_sh[0] *= w_cam; left_sh[1] *= h_cam
    right_sh = pose[12, :2].copy(); right_sh[0] *= w_cam; right_sh[1] *= h_cam
    mid_shoulder = (left_sh + right_sh) / 2.0
    sh_width = float(np.linalg.norm(left_sh - right_sh))
    if sh_width < 1e-6:
        sh_width = 1.0

    for start, end, stride in [(0, 132, 4), (132, 312, 3), (312, 375, 3), (375, 438, 3)]:
        block = frame[start:end].reshape(-1, stride)
        nz = np.any(block != 0, axis=1)
        x_px = block[nz, 0] * w_cam
        y_px = block[nz, 1] * h_cam
        block[nz, 0] = (x_px - mid_shoulder[0]) / sh_width
        block[nz, 1] = (y_px - mid_shoulder[1]) / sh_width
        block[nz, 2] = (block[nz, 2] * w_cam) / sh_width
        frame[start:end] = block.reshape(-1)

    return frame


def add_arm_hand_velocity_features(x: np.ndarray) -> np.ndarray:
    """x: (1, T, 438) → (1, T, 612)"""
    ARM_START, ARM_END = 11 * 4, 23 * 4
    LH_START, LH_END = 312, 375
    RH_START, RH_END = 375, 438
    arms_raw = x[:, :, ARM_START:ARM_END]
    lh_raw = x[:, :, LH_START:LH_END]
    rh_raw = x[:, :, RH_START:RH_END]

    def velocity(arr):
        vel = np.zeros_like(arr)
        vel[:, 1:, :] = arr[:, 1:, :] - arr[:, :-1, :]
        return vel

    arms_vel = velocity(arms_raw)
    hands_vel = velocity(np.concatenate([lh_raw, rh_raw], axis=-1))
    return np.concatenate([x, arms_vel, hands_vel], axis=-1)


def preprocess_sequence(frames: list, seq_len: int) -> np.ndarray:
    """list[(438,)] → (1, seq_len, 612). Resample tuyến tính theo thời gian."""
    arr = np.array(frames, dtype=np.float32)
    T = arr.shape[0]
    resampled = np.zeros((seq_len, 438), dtype=np.float32)
    time_orig = np.linspace(0, 1, T)
    time_new = np.linspace(0, 1, seq_len)
    for i in range(438):
        resampled[:, i] = np.interp(time_new, time_orig, arr[:, i])
    return add_arm_hand_velocity_features(resampled[np.newaxis, ...])
