from tensorflow.keras.models import load_model
m = load_model("models/best_model.keras")
print(m.input_shape)
print(m.output_shape)
