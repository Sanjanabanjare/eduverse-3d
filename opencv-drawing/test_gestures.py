"""Unit tests for gestures.py using synthetic 21-point hands (no camera / MediaPipe needed).

Run:  python3 test_gestures.py
"""
import math
import random
import unittest

import gestures as g

MCP_X = {"index": 0.44, "middle": 0.50, "ring": 0.56, "pinky": 0.62}
LM_IDX = {"index": (5, 6, 7, 8), "middle": (9, 10, 11, 12), "ring": (13, 14, 15, 16), "pinky": (17, 18, 19, 20)}


def make_hand(index=False, middle=False, ring=False, pinky=False, thumb="tucked", pinch=False):
    """Upright hand, wrist at (0.5, 0.8), hand size 0.2. Returns 21 (x, y, z) points."""
    lm = [(0.5, 0.8, 0.0)] * 21
    lm = list(lm)
    lm[0] = (0.5, 0.8, 0.0)
    for name, up in (("index", index), ("middle", middle), ("ring", ring), ("pinky", pinky)):
        x = MCP_X[name]
        mcp, pip, dip, tip = LM_IDX[name]
        lm[mcp] = (x, 0.60, 0.0)
        if up:
            lm[pip], lm[dip], lm[tip] = (x, 0.53, 0.0), (x, 0.48, 0.0), (x, 0.44, 0.0)
        else:  # curled into the palm
            lm[pip], lm[dip], lm[tip] = (x, 0.54, 0.0), (x, 0.59, 0.0), (x, 0.64, 0.0)
    lm[1] = (0.45, 0.76, 0.0)
    lm[2] = (0.42, 0.70, 0.0)
    if thumb == "tucked":
        lm[3], lm[4] = (0.44, 0.67, 0.0), (0.46, 0.66, 0.0)
    elif thumb == "out":
        lm[3], lm[4] = (0.36, 0.65, 0.0), (0.30, 0.60, 0.0)
    elif thumb == "up":
        lm[3], lm[4] = (0.41, 0.58, 0.0), (0.40, 0.44, 0.0)
    elif thumb == "down":
        lm[3], lm[4] = (0.41, 0.82, 0.0), (0.40, 0.96, 0.0)
    if pinch:
        tip = lm[8]
        lm[4] = (tip[0] - 0.02, tip[1] + 0.01, 0.0)
    return lm


def transform(lm, angle_deg=0.0, scale=1.0, dx=0.0, dy=0.0):
    a = math.radians(angle_deg)
    cx, cy = lm[0][0], lm[0][1]
    out = []
    for x, y, z in lm:
        rx = (x - cx) * math.cos(a) - (y - cy) * math.sin(a)
        ry = (x - cx) * math.sin(a) + (y - cy) * math.cos(a)
        out.append((cx + rx * scale + dx, cy + ry * scale + dy, z * scale))
    return out


class GestureRules(unittest.TestCase):
    def label(self, lm):
        return g.classify(lm)["label"]

    def test_open_palm(self):
        self.assertEqual(self.label(make_hand(True, True, True, True, thumb="out")), "OPEN_PALM")

    def test_fist(self):
        self.assertEqual(self.label(make_hand()), "FIST")

    def test_one_finger(self):
        self.assertEqual(self.label(make_hand(index=True)), "ONE_FINGER")

    def test_two_fingers(self):
        self.assertEqual(self.label(make_hand(index=True, middle=True)), "TWO_FINGERS")

    def test_thumbs_up_and_down(self):
        self.assertEqual(self.label(make_hand(thumb="up")), "THUMBS_UP")
        self.assertEqual(self.label(make_hand(thumb="down")), "THUMBS_DOWN")

    def test_three_fingers_is_unknown(self):
        self.assertEqual(self.label(make_hand(True, True, True)), "UNKNOWN")

    def test_pinch(self):
        r = g.classify(make_hand(index=True, middle=True, ring=True, pinky=True, pinch=True))
        self.assertEqual(r["label"], "PINCH")
        self.assertTrue(r["pinch"])
        self.assertLess(r["pinchRatio"], g.PINCH_RATIO)

    def test_open_hand_is_not_pinch(self):
        r = g.classify(make_hand(True, True, True, True, thumb="out"))
        self.assertFalse(r["pinch"])
        self.assertGreater(r["pinchRatio"], 0.6)

    def test_rotation_scale_translation_invariance(self):
        cases = {"OPEN_PALM": make_hand(True, True, True, True, "out"), "FIST": make_hand(),
                 "ONE_FINGER": make_hand(index=True), "TWO_FINGERS": make_hand(index=True, middle=True),
                 "PINCH": make_hand(True, True, True, True, pinch=True)}
        for expected, hand in cases.items():
            for angle in (0, 35, 90, 180, 270):
                for scale in (0.5, 1.0, 1.8):
                    moved = transform(hand, angle, scale, 0.03, -0.02)
                    self.assertEqual(self.label(moved), expected, f"{expected} @ {angle}° x{scale}")

    def test_confidence_is_in_range(self):
        for hand in (make_hand(), make_hand(index=True), make_hand(True, True, True, True, "out")):
            self.assertTrue(0.0 <= g.classify(hand)["confidence"] <= 1.0)


class Normalisation(unittest.TestCase):
    def test_features_ignore_position_and_distance(self):
        base = make_hand(index=True)
        a = g.normalize(base)
        b = g.normalize(transform(base, 0, 0.5, 0.2, 0.1))
        self.assertEqual(len(a), 63)
        self.assertLess(max(abs(x - y) for x, y in zip(a, b)), 0.01)

    def test_wrist_is_origin(self):
        f = g.normalize(make_hand())
        self.assertEqual(f[:3], [0.0, 0.0, 0.0])


class Knn(unittest.TestCase):
    def noisy(self, hand, rng):
        return g.normalize([(x + rng.gauss(0, .004), y + rng.gauss(0, .004), z) for x, y, z in hand])

    def test_trains_and_predicts_custom_gestures(self):
        rng = random.Random(7)
        shapes = {"palm": make_hand(True, True, True, True, "out"), "fist": make_hand(),
                  "point": make_hand(index=True), "my-gesture": make_hand(True, False, False, True)}
        samples = [{"label": n, "features": self.noisy(h, rng)} for n, h in shapes.items() for _ in range(15)]
        acc = g.leave_one_out_accuracy(samples)
        self.assertGreater(acc, 0.95)
        for name, hand in shapes.items():
            pred = g.knn_predict(self.noisy(hand, rng), samples)
            self.assertEqual(pred["label"], name)

    def test_needs_two_labels(self):
        rng = random.Random(1)
        samples = [{"label": "a", "features": self.noisy(make_hand(), rng)} for _ in range(5)]
        self.assertFalse(g.knn_predict(samples[0]["features"], samples)["trained"])
        self.assertIsNone(g.leave_one_out_accuracy(samples))


if __name__ == "__main__":
    unittest.main(verbosity=2)
