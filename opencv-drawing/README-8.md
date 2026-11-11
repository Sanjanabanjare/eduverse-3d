# EduVerse OpenCV vision service (local, port 4174)

A tiny Python service that powers the webcam Vision Lab: fingertip tracking,
21-landmark MediaPipe hand tracking, gesture classification, live sketch
filters, color analysis, and face/gaze detection. Everything runs on this
computer — no camera frame ever leaves the machine.

The Node server starts this service automatically when
`opencv-drawing/.venv-mediapipe/bin/python` exists. You can also run it by
hand:

```bash
cd opencv-drawing
python3 server.py
```

## One-time setup (for hand tracking)

Hand landmark tracking needs MediaPipe in an isolated Python 3.12
environment:

```bash
cd opencv-drawing
python3.12 -m venv .venv-mediapipe
TMPDIR="$PWD/.tmp-pip" .venv-mediapipe/bin/pip install -r requirements-mediapipe.txt
```

Notes:

- Use `TMPDIR` on the main disk — pip's default `/tmp` is often a small
  tmpfs and runs out of space unpacking the large wheels.
- Install **only** `requirements-mediapipe.txt` (opencv-contrib). Installing
  `requirements.txt` (plain opencv-python) as well conflicts with it.
- Without the venv, the service still runs with OpenCV contour tracking,
  but the handwriting studio requires MediaPipe landmarks.

## Endpoints

- `GET /health` — service status and capabilities
- `GET /hands/status` — whether the MediaPipe tracker loaded
- `POST /hands` — JPEG frame → 21 landmarks, gesture, pinch per hand
- `POST /track` — JPEG frame → contour fingertip fallback
- `POST /perceive` — face / eye / person detection for posture labs
- `POST /stylize?mode=classic|tutorial` — live Canny sketch filter
- `POST /analyze` — centre-frame color naming
- `POST /scan` — high-contrast board cleanup (not OCR)
- `POST /learn`, `/classify`, `/reset` — gesture trainer samples

Only `http(s)://127.0.0.1`, `localhost`, and `::1` origins are accepted.

## Tests

```bash
cd opencv-drawing
python3 test_gestures.py
```
