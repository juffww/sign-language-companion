# Raspberry Pi Streamer

```bash
sudo apt update && sudo apt install -y python3-pip python3-opencv
cd ~/pi_client
pip3 install -r requirements.txt

# Test:
export BACKEND_WS_URL="wss://YOUR-TUNNEL.trycloudflare.com/ws/pi/pi-01?token=change-me"
export USE_PICAM=1   # bỏ nếu dùng USB webcam
python3 stream.py
```

## Auto-start lúc boot

```bash
sudo cp systemd/sign-stream.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sign-stream
journalctl -u sign-stream -f
```
