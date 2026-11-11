"""Optional MediaPipe 21-point hand tracker for EduVerse's local OpenCV service.

macOS uses MediaPipe 0.10.21's CPU Solutions graph. Frames are decoded and
processed locally; this module returns landmarks only and never stores frames.
"""
from __future__ import annotations

import threading
import time

import cv2
import numpy as np

import gestures

_lock = threading.Lock()
_tracker = None
_error: str | None = None
_loaded = False
_recent: list[float] = []
_backend = "MediaPipe Hands (CPU)"


def _load() -> None:
    global _tracker, _error, _loaded
    if _loaded:
        return
    _loaded = True
    try:
        import mediapipe as mp
        solutions = getattr(mp, "solutions", None)
        if solutions is None:
            try:
                from mediapipe.python import solutions
            except Exception:
                solutions = None
        if solutions is None:
            raise RuntimeError(
                f"MediaPipe {getattr(mp, '__version__', 'unknown')} does not expose the stable "
                "macOS Hands graph. Use Python 3.12 and install requirements-mediapipe.txt."
            )
        _tracker = solutions.hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            model_complexity=0,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    except Exception as exc:
        _error = str(exc)


def status() -> dict:
    _load()
    return {"available": _tracker is not None, "reason": _error, "backend": _backend}


def detect(jpeg: bytes, mirror: bool = True) -> dict:
    """Return 21 normalized landmarks and gestures for each detected hand."""
    _load()
    if _tracker is None:
        return {"available": False, "detected": False, "reason": _error}
    frame = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Could not read this camera frame")
    if mirror:
        frame = cv2.flip(frame, 1)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    started = time.perf_counter()
    with _lock:
        result = _tracker.process(np.ascontiguousarray(rgb))
    inference_ms = (time.perf_counter() - started) * 1000
    now = time.time()
    _recent.append(now)
    while _recent and now - _recent[0] > 2.0:
        _recent.pop(0)
    hands = []
    point_sets = result.multi_hand_landmarks or []
    handedness_sets = result.multi_handedness or []
    for i, point_set in enumerate(point_sets):
        lm = [[round(p.x, 4), round(p.y, 4), round(p.z, 4)] for p in point_set.landmark]
        classifications = handedness_sets[i].classification if i < len(handedness_sets) else []
        classification = classifications[0] if classifications else None
        verdict = gestures.classify(lm)
        hands.append({
            "landmarks": lm,
            "handedness": classification.label if classification else None,
            "score": round(float(classification.score), 2) if classification else None,
            "gesture": verdict["label"],
            "gestureConfidence": verdict["confidence"],
            "pinch": verdict["pinch"],
            "pinchRatio": verdict["pinchRatio"],
            "fingers": verdict["fingers"],
            "features": gestures.normalize(lm),
        })
    return {"available": True, "detected": bool(hands), "handCount": len(hands), "hands": hands,
            "inferenceMs": round(inference_ms, 1), "serverFps": round(len(_recent) / 2.0, 1)}
