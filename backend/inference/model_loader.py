"""Load TF model + label mapping once at startup."""
import json
import os
import tensorflow as tf
from config import settings

# Limit threads on CPU laptop
tf.config.threading.set_intra_op_parallelism_threads(2)
tf.config.threading.set_inter_op_parallelism_threads(2)

print(f"[model] Loading {settings.MODEL_PATH} ...")
model = tf.keras.models.load_model(settings.MODEL_PATH, compile=False)

with open(settings.META_PATH, "r", encoding="utf-8") as f:
    meta = json.load(f)

with open(settings.INDEX_MAPPING_PATH, "r", encoding="utf-8") as f:
    index_mapping = json.load(f)

# index_mapping is expected to be {"0": "word", "1": "word", ...} OR list
if isinstance(index_mapping, dict):
    idx_to_word = {int(k): v for k, v in index_mapping.items()}
else:
    idx_to_word = {i: w for i, w in enumerate(index_mapping)}

NUM_CLASSES = len(idx_to_word)
print(f"[model] Loaded. classes={NUM_CLASSES} input_shape={model.input_shape}")

# Pre-warm
import numpy as np
_dummy = np.zeros((1, settings.SEQ_LEN, model.input_shape[-1]), dtype=np.float32)
model.predict(_dummy, verbose=0)
print("[model] Warmup done.")
