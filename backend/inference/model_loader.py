"""Load model bằng build_model + load_weights từ file .keras (zip).
Khớp HỆT live_test_with_velocity.py: PadMask + BahdanauAttention + multi-branch BiLSTM.
"""
from __future__ import annotations
import json
import os
import tempfile
import zipfile
import numpy as np
import tensorflow as tf

from config import settings

tf.config.threading.set_intra_op_parallelism_threads(2)
tf.config.threading.set_inter_op_parallelism_threads(2)


class PadMask(tf.keras.layers.Layer):
    def call(self, x):
        return tf.reduce_any(tf.not_equal(x, 0.0), axis=-1)

    def get_config(self):
        return super().get_config()


class BahdanauAttention(tf.keras.layers.Layer):
    def __init__(self, attn_dim, **kwargs):
        super().__init__(**kwargs)
        self.attn_dim = attn_dim
        self.W = tf.keras.layers.Dense(attn_dim, use_bias=True)
        self.v = tf.keras.layers.Dense(1, use_bias=False)

    def build(self, input_shape):
        self.W = tf.keras.layers.Dense(self.attn_dim, use_bias=True)
        self.v = tf.keras.layers.Dense(1, use_bias=False)
        self.W.build(input_shape)
        v_shape = list(input_shape[:-1]) + [self.attn_dim]
        self.v.build(v_shape)
        super().build(input_shape)

    def call(self, hidden_states, mask=None):
        energy = self.v(tf.nn.tanh(self.W(hidden_states)))
        energy = tf.squeeze(energy, axis=-1)
        if mask is not None:
            energy += (1.0 - tf.cast(mask, tf.float32)) * -1e9
        attn_weights = tf.nn.softmax(energy, axis=1)
        context = tf.matmul(tf.expand_dims(attn_weights, 1), hidden_states)
        context = tf.squeeze(context, axis=1)
        return context, attn_weights

    def get_config(self):
        cfg = super().get_config()
        cfg.update({"attn_dim": self.attn_dim})
        return cfg


def build_model(seq_len, input_dim, hidden_dim, num_layers, attn_dim, num_classes, dropout):
    inp = tf.keras.Input(shape=(seq_len, input_dim), name="landmarks")
    pad_mask = PadMask(name="pad_mask")(inp)

    pose_full = inp[:, :, 0:132]
    face_full = inp[:, :, 132:312]
    hands_full = inp[:, :, 312:438]
    arms_vel = inp[:, :, 438:486]
    hands_vel = inp[:, :, 486:612]

    pose_input = tf.keras.layers.Concatenate()([pose_full, arms_vel])
    hands_input = tf.keras.layers.Concatenate()([hands_full, hands_vel])

    p = tf.keras.layers.Dense(128, use_bias=False, name="pose_dense")(pose_input)
    p = tf.keras.layers.BatchNormalization(name="pose_bn")(p)
    p = tf.keras.layers.Activation("relu")(p)

    f = tf.keras.layers.Dense(64, use_bias=False, name="face_dense")(face_full)
    f = tf.keras.layers.BatchNormalization(name="face_bn")(f)
    f = tf.keras.layers.Activation("relu")(f)

    h = tf.keras.layers.Dense(128, use_bias=False, name="hands_dense")(hands_input)
    h = tf.keras.layers.BatchNormalization(name="hands_bn")(h)
    h = tf.keras.layers.Activation("relu")(h)

    x = tf.keras.layers.Concatenate(name="concat_branches")([p, f, h])
    x = tf.keras.layers.SpatialDropout1D(0.2, name="spatial_dropout")(x)

    for i in range(num_layers):
        lstm = tf.keras.layers.LSTM(hidden_dim, return_sequences=True,
                                    dropout=dropout, name=f"lstm_{i}")
        x = tf.keras.layers.Bidirectional(lstm, name=f"bilstm_{i}")(x)
        if i < num_layers - 1:
            x = tf.keras.layers.LayerNormalization(name=f"ln_{i}")(x)

    context, attn_w = BahdanauAttention(attn_dim, name="attention")(x, mask=pad_mask)
    x = tf.keras.layers.Dropout(dropout, name="drop_1")(context)
    x = tf.keras.layers.Dense(hidden_dim, activation="relu", name="fc_1")(x)
    x = tf.keras.layers.Dropout(dropout, name="drop_2")(x)
    out = tf.keras.layers.Dense(num_classes, activation="softmax", name="predictions")(x)
    return tf.keras.Model(inputs=inp, outputs=[out, attn_w], name="MultiBranch_Velocity_BiLSTM")


# ── Load meta + labels ──
print(f"[model] Loading meta {settings.META_PATH}")
with open(settings.META_PATH, "r", encoding="utf-8") as f:
    meta = json.load(f)

with open(settings.INDEX_MAPPING_PATH, "r", encoding="utf-8") as f:
    index_mapping = json.load(f)
if isinstance(index_mapping, dict):
    idx_to_word = {int(k): v for k, v in index_mapping.items()}
else:
    idx_to_word = {i: w for i, w in enumerate(index_mapping)}

NUM_CLASSES = len(idx_to_word)
SEQ_LEN = int(meta["seq_len"])
INPUT_DIM = int(meta["input_dim"])

print(f"[model] Building model: seq_len={SEQ_LEN} input_dim={INPUT_DIM} classes={NUM_CLASSES}")
model = build_model(
    seq_len=SEQ_LEN,
    input_dim=INPUT_DIM,
    hidden_dim=int(meta["hidden_dim"]),
    num_layers=int(meta["num_layers"]),
    attn_dim=int(meta["attn_dim"]),
    num_classes=NUM_CLASSES,
    dropout=float(meta["dropout"]),
)

print(f"[model] Loading weights from {settings.MODEL_PATH}")
with zipfile.ZipFile(settings.MODEL_PATH, "r") as z:
    tmpdir = tempfile.mkdtemp()
    z.extract("model.weights.h5", tmpdir)
model.load_weights(os.path.join(tmpdir, "model.weights.h5"))

# Warmup
_dummy = np.zeros((1, SEQ_LEN, INPUT_DIM), dtype=np.float32)
model.predict(_dummy, verbose=0)
print("[model] Warmup done.")
