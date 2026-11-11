"""Hand-landmark geometry and rule-based gesture recognition.

Pure Python (no OpenCV / MediaPipe imports) so every rule can be unit-tested with
synthetic hands. Input is the 21-point MediaPipe hand skeleton:

    0 wrist
    1-4 thumb (CMC, MCP, IP, TIP)      5-8 index (MCP, PIP, DIP, TIP)
    9-12 middle                        13-16 ring        17-20 pinky

Landmarks are (x, y, z) with x, y normalised to 0-1 image coordinates (y grows downward).
All distances are divided by the *hand size* (wrist -> middle-finger MCP), so results do
not depend on how far the hand is from the camera, or on where it is in the frame.
"""
from __future__ import annotations

import math
from typing import Sequence

Landmarks = Sequence[Sequence[float]]

WRIST, THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP = 0, 1, 2, 3, 4
INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP = 5, 6, 7, 8
MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP = 9, 10, 11, 12
RING_MCP, RING_PIP, RING_DIP, RING_TIP = 13, 14, 15, 16
PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP = 17, 18, 19, 20

LANDMARK_NAMES = [
    "Wrist", "Thumb CMC", "Thumb MCP", "Thumb IP", "Thumb tip",
    "Index MCP", "Index PIP", "Index DIP", "Index tip",
    "Middle MCP", "Middle PIP", "Middle DIP", "Middle tip",
    "Ring MCP", "Ring PIP", "Ring DIP", "Ring tip",
    "Pinky MCP", "Pinky PIP", "Pinky DIP", "Pinky tip",
]

# (name, pip, tip) for the four long fingers; the thumb is handled separately.
FINGERS = (("index", INDEX_PIP, INDEX_TIP), ("middle", MIDDLE_PIP, MIDDLE_TIP),
           ("ring", RING_PIP, RING_TIP), ("pinky", PINKY_PIP, PINKY_TIP))

EXTENDED_RATIO = 1.2   # tip is >20% farther from the wrist than the PIP joint => extended
PINCH_MIN_REACH = 1.0  # index tip must be this many hand-sizes from the wrist for a pinch
PINCH_RATIO = 0.25     # thumb-tip to index-tip distance / hand size below this => pinch


def _dist(a: Sequence[float], b: Sequence[float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def hand_size(lm: Landmarks) -> float:
    """Wrist -> middle-finger MCP distance; the unit that makes features scale-invariant."""
    return max(_dist(lm[WRIST], lm[MIDDLE_MCP]), 1e-6)


def pinch_ratio(lm: Landmarks) -> float:
    """Thumb-tip / index-tip distance in hand-size units (small = pinching)."""
    return _dist(lm[THUMB_TIP], lm[INDEX_TIP]) / hand_size(lm)


def finger_ratios(lm: Landmarks) -> dict[str, float]:
    """For each long finger: dist(tip, wrist) / dist(pip, wrist). >1 means stretched out.

    Using distance from the wrist (not the y coordinate) keeps this rotation invariant,
    so the hand can point sideways or downwards.
    """
    wrist = lm[WRIST]
    return {name: _dist(lm[tip], wrist) / max(_dist(lm[pip], wrist), 1e-6) for name, pip, tip in FINGERS}


def thumb_state(lm: Landmarks) -> dict:
    """Thumb extension, plus its direction relative to the hand (used for thumbs up/down)."""
    size = hand_size(lm)
    # The thumb folds across the palm, so measure it against the pinky base instead of the wrist.
    extended = _dist(lm[THUMB_TIP], lm[PINKY_MCP]) > _dist(lm[THUMB_IP], lm[PINKY_MCP]) * 1.1 \
        and _dist(lm[THUMB_TIP], lm[INDEX_MCP]) / size > 0.55
    dx = (lm[THUMB_TIP][0] - lm[THUMB_MCP][0]) / size
    dy = (lm[THUMB_TIP][1] - lm[THUMB_MCP][1]) / size
    return {"extended": extended, "dx": dx, "dy": dy}


def finger_states(lm: Landmarks) -> dict:
    ratios = finger_ratios(lm)
    states = {name: ratio > EXTENDED_RATIO for name, ratio in ratios.items()}
    thumb = thumb_state(lm)
    states["thumb"] = thumb["extended"]
    return {"states": states, "ratios": ratios, "thumb": thumb}


def normalize(lm: Landmarks) -> list[float]:
    """Translate so the wrist is the origin and divide by hand size -> 63 numbers.

    Invariant to hand position and distance from the camera, but NOT to rotation: tell students
    to hold their hand upright when they record gesture samples.

    This is the feature vector for the machine-learning gesture trainer: two people making
    the same gesture at different distances / positions give similar vectors.
    """
    size = hand_size(lm)
    wx, wy, wz = lm[WRIST][0], lm[WRIST][1], (lm[WRIST][2] if len(lm[WRIST]) > 2 else 0.0)
    out: list[float] = []
    for p in lm:
        z = p[2] if len(p) > 2 else 0.0
        out.extend([round((p[0] - wx) / size, 4), round((p[1] - wy) / size, 4), round((z - wz) / size, 4)])
    return out


def classify(lm: Landmarks) -> dict:
    """Rule-based gesture + confidence. Returns label in:

    PINCH, OPEN_PALM, FIST, ONE_FINGER, TWO_FINGERS, THUMBS_UP, THUMBS_DOWN, UNKNOWN
    """
    info = finger_states(lm)
    s, ratios, thumb = info["states"], info["ratios"], info["thumb"]
    pinch = pinch_ratio(lm)
    long_up = [n for n in ("index", "middle", "ring", "pinky") if s[n]]

    def margin(names: Sequence[str]) -> float:
        # How decisively each finger is extended / curled: 0 (on the threshold) .. 1 (clear-cut).
        if not names:
            return 0.5
        return sum(min(1.0, abs(ratios[n] - EXTENDED_RATIO) / 0.25) for n in names) / len(names)

    # A real pinch happens away from the palm. In a closed fist the curled index fingertip also
    # touches the thumb, so require the pinch point to be well clear of the wrist.
    pinch_reach = _dist(lm[INDEX_TIP], lm[WRIST]) / hand_size(lm)
    if pinch < PINCH_RATIO and pinch_reach > PINCH_MIN_REACH:
        conf = 0.6 + 0.4 * min(1.0, (PINCH_RATIO - pinch) / PINCH_RATIO)
        return _result("PINCH", conf, info, pinch)
    if len(long_up) == 4 and s["thumb"]:
        return _result("OPEN_PALM", 0.55 + 0.45 * margin(long_up), info, pinch)
    if not long_up:
        if s["thumb"] and abs(thumb["dy"]) > abs(thumb["dx"]) and abs(thumb["dy"]) > 0.6:
            label = "THUMBS_UP" if thumb["dy"] < 0 else "THUMBS_DOWN"
            return _result(label, 0.6 + 0.4 * min(1.0, (abs(thumb["dy"]) - 0.6) / 0.6), info, pinch)
        return _result("FIST", 0.55 + 0.45 * margin(["index", "middle", "ring", "pinky"]), info, pinch)
    if long_up == ["index"]:
        return _result("ONE_FINGER", 0.55 + 0.45 * margin(["index", "middle", "ring", "pinky"]), info, pinch)
    if long_up == ["index", "middle"]:
        return _result("TWO_FINGERS", 0.55 + 0.45 * margin(["index", "middle", "ring", "pinky"]), info, pinch)
    return _result("UNKNOWN", 0.3, info, pinch)


def _result(label: str, confidence: float, info: dict, pinch: float) -> dict:
    return {
        "label": label,
        "confidence": round(min(1.0, confidence), 2),
        "pinchRatio": round(pinch, 3),
        "pinch": label == "PINCH",
        "fingers": {k: bool(v) for k, v in info["states"].items()},
    }


# --- k-NN over normalised landmarks (used by the gesture trainer) ---------------------------

def knn_predict(features: Sequence[float], samples: Sequence[dict], k: int = 5) -> dict:
    """Distance-weighted k-NN. `samples` are {"label": str, "features": [63 floats]}."""
    labels = {s["label"] for s in samples}
    if len(samples) < 2 or len(labels) < 2:
        return {"trained": False, "message": "Collect examples for at least two gestures first."}
    scored = sorted(
        (math.sqrt(sum((a - b) ** 2 for a, b in zip(features, s["features"]))), s["label"]) for s in samples
    )[:k]
    votes: dict[str, float] = {}
    for d, label in scored:
        votes[label] = votes.get(label, 0.0) + 1.0 / max(d, 0.05)
    best = max(votes, key=votes.get)
    return {"trained": True, "label": best, "confidence": round(votes[best] / sum(votes.values()), 2),
            "examples": len(samples)}


def leave_one_out_accuracy(samples: Sequence[dict], k: int = 5) -> float | None:
    """Honest accuracy estimate: classify each sample using all the *others*."""
    if len({s["label"] for s in samples}) < 2 or len(samples) < 4:
        return None
    hits = 0
    for i, s in enumerate(samples):
        rest = [x for j, x in enumerate(samples) if j != i]
        pred = knn_predict(s["features"], rest, k)
        hits += bool(pred.get("trained") and pred["label"] == s["label"])
    return round(hits / len(samples), 3)
