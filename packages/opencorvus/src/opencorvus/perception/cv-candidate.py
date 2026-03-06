#!/usr/bin/env python3

import argparse
import json
import math
import sys

import cv2
import numpy as np


def clamp(v: int, lo: int, hi: int) -> int:
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v


def iou(a: dict, b: dict) -> float:
    ax1 = a["bbox"]["x"]
    ay1 = a["bbox"]["y"]
    ax2 = ax1 + a["bbox"]["width"]
    ay2 = ay1 + a["bbox"]["height"]
    bx1 = b["bbox"]["x"]
    by1 = b["bbox"]["y"]
    bx2 = bx1 + b["bbox"]["width"]
    by2 = by1 + b["bbox"]["height"]
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(1, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1, (bx2 - bx1) * (by2 - by1))
    union = area_a + area_b - inter
    return inter / float(max(1, union))


def contains(a: dict, b: dict) -> bool:
    ax1 = a["bbox"]["x"]
    ay1 = a["bbox"]["y"]
    ax2 = ax1 + a["bbox"]["width"]
    ay2 = ay1 + a["bbox"]["height"]
    bx1 = b["bbox"]["x"]
    by1 = b["bbox"]["y"]
    bx2 = bx1 + b["bbox"]["width"]
    by2 = by1 + b["bbox"]["height"]
    return ax1 <= bx1 and ay1 <= by1 and ax2 >= bx2 and ay2 >= by2


def center(box: dict) -> tuple[float, float]:
    return (box["x"] + box["width"] / 2.0, box["y"] + box["height"] / 2.0)


def center_dist(a: dict, b: dict) -> float:
    ax, ay = center(a["bbox"])
    bx, by = center(b["bbox"])
    return float(math.hypot(ax - bx, ay - by))


def size_score(area_ratio: float) -> float:
    # Prefer small/medium UI controls; penalize giant containers.
    if area_ratio <= 0:
        return 0.0
    pivot = 0.0012
    spread = 1.2
    value = math.exp(-((math.log(area_ratio) - math.log(pivot)) ** 2) / (2 * spread * spread))
    if area_ratio > 0.02:
        value *= 0.15
    if area_ratio > 0.01:
        value *= 0.45
    return float(max(0.0, min(1.0, value)))


def aspect_score(ratio: float) -> float:
    if ratio <= 0:
        return 0.0
    if 0.7 <= ratio <= 5.5:
        return 1.0
    if 0.35 <= ratio < 0.7:
        return 0.7
    if 5.5 < ratio <= 10:
        return 0.7
    return 0.0


def add_raw(
    raw: list[dict],
    edge: np.ndarray,
    contours: list[np.ndarray],
    w: int,
    h: int,
    area_img: float,
    source: str,
) -> None:
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        area = width * height
        area_ratio = area / area_img

        if area < 180:
            continue
        if area_ratio > 0.12:
            continue
        if width < 12 or height < 10:
            continue
        if width > int(w * 0.85) or height > int(h * 0.55):
            continue
        if width > int(w * 0.18) and height < int(h * 0.08):
            continue

        ratio = width / float(max(1, height))
        if ratio < 0.18 or ratio > 16:
            continue

        contour_area = cv2.contourArea(contour)
        if contour_area <= 0:
            continue
        fill = contour_area / float(max(1, area))
        if fill < 0.05:
            continue

        perim = cv2.arcLength(contour, True)
        if perim <= 0:
            continue
        approx = cv2.approxPolyDP(contour, 0.03 * perim, True)
        points = len(approx)
        if points < 4 or points > 14:
            continue

        pad = max(1, int(min(width, height) * 0.10))
        x1 = clamp(x - pad, 0, w - 1)
        y1 = clamp(y - pad, 0, h - 1)
        x2 = clamp(x + width + pad, 0, w)
        y2 = clamp(y + height + pad, 0, h)
        roi = edge[y1:y2, x1:x2]
        if roi.size == 0:
            continue
        edge_density = float(np.count_nonzero(roi)) / float(max(1, roi.size))

        # Favor regular quadrilateral-like contours.
        polygon_score = 1.0 - min(1.0, abs(points - 4) / 10.0)
        score = (
            fill * 0.18
            + min(1.0, edge_density * 3.6) * 0.22
            + size_score(area_ratio) * 0.42
            + aspect_score(ratio) * 0.14
            + polygon_score * 0.04
        )
        raw.append(
            {
                "bbox": {
                    "x": int(x),
                    "y": int(y),
                    "width": int(width),
                    "height": int(height),
                },
                "score": float(score),
                "area_ratio": float(area_ratio),
                "source": source,
            }
        )


def add_text(
    raw: list[dict],
    edge: np.ndarray,
    binary: np.ndarray,
    w: int,
    h: int,
    area_img: float,
) -> None:
    merged = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((17, 3), np.uint8), iterations=1)
    merged = cv2.morphologyEx(merged, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)
    contours, _ = cv2.findContours(merged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        area = width * height
        area_ratio = area / area_img
        if area < 200:
            continue
        if area_ratio > 0.02:
            continue
        if width < 24 or height < 12:
            continue
        if height > int(h * 0.12):
            continue
        if width > int(w * 0.16) and height < int(h * 0.08):
            continue
        ratio = width / float(max(1, height))
        if ratio < 1.0 or ratio > 20:
            continue
        y2 = min(h, y + height)
        x2 = min(w, x + width)
        bin_roi = binary[y:y2, x:x2]
        edge_roi = edge[y:y2, x:x2]
        if bin_roi.size == 0:
            continue
        ink = float(np.count_nonzero(bin_roi)) / float(max(1, bin_roi.size))
        if ink < 0.06 or ink > 0.92:
            continue
        edge_density = float(np.count_nonzero(edge_roi)) / float(max(1, edge_roi.size))
        pad_x = max(2, int(width * 0.08))
        pad_y = max(2, int(height * 0.12))
        px = clamp(x - pad_x, 0, w - 1)
        py = clamp(y - pad_y, 0, h - 1)
        pw = max(1, min(w - px, width + pad_x * 2))
        ph = max(1, min(h - py, height + pad_y * 2))
        score = (
            size_score(area_ratio) * 0.44
            + aspect_score(ratio) * 0.20
            + min(1.0, edge_density * 4.5) * 0.24
            + min(1.0, ink * 1.6) * 0.12
        )
        raw.append(
            {
                "bbox": {
                    "x": int(px),
                    "y": int(py),
                    "width": int(pw),
                    "height": int(ph),
                },
                "score": float(score),
                "area_ratio": float((pw * ph) / area_img),
                "source": "text",
            }
        )


def detect(image: np.ndarray, limit: int) -> list[dict]:
    h, w = image.shape[:2]
    area_img = float(max(1, w * h))
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    edge = cv2.Canny(blur, 45, 160)
    edge = cv2.dilate(edge, np.ones((3, 3), np.uint8), iterations=1)

    # Dark-on-light and light-on-dark channels to improve control/text box recall.
    bin_dark = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 8
    )
    bin_light = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, -8
    )
    bin_dark = cv2.morphologyEx(bin_dark, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
    bin_light = cv2.morphologyEx(bin_light, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)

    contours_edge, _ = cv2.findContours(edge, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    contours_dark, _ = cv2.findContours(bin_dark, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    contours_light, _ = cv2.findContours(bin_light, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

    raw: list[dict] = []
    add_raw(raw, edge, contours_edge, w, h, area_img, "edge")
    add_raw(raw, edge, contours_dark, w, h, area_img, "dark")
    add_raw(raw, edge, contours_light, w, h, area_img, "light")
    add_text(raw, edge, bin_dark, w, h, area_img)

    raw.sort(key=lambda item: item["score"], reverse=True)
    keep: list[dict] = []
    for item in raw:
        bad = False
        for chosen in keep:
            if iou(item, chosen) > 0.72:
                bad = True
                break
            if contains(chosen, item) and chosen["score"] >= item["score"]:
                bad = True
                break
            cx = item["bbox"]["x"] + item["bbox"]["width"] / 2.0
            cy = item["bbox"]["y"] + item["bbox"]["height"] / 2.0
            px = chosen["bbox"]["x"] + chosen["bbox"]["width"] / 2.0
            py = chosen["bbox"]["y"] + chosen["bbox"]["height"] / 2.0
            if abs(cx - px) <= 10 and abs(cy - py) <= 10:
                bad = True
                break
        if bad:
            continue
        keep.append(item)
        if len(keep) >= max(limit * 3, limit + 40):
            break

    # Penalize giant container-like candidates that include many smaller boxes.
    if keep:
        child_count = [0 for _ in keep]
        for i, item in enumerate(keep):
            for j, other in enumerate(keep):
                if i == j:
                    continue
                if contains(item, other):
                    child_count[i] += 1
        rescored = []
        for i, item in enumerate(keep):
            box = item["bbox"]
            cx, cy = center(box)
            penalty = 0.0
            if item["area_ratio"] > 0.006:
                penalty += min(0.45, child_count[i] * 0.06)
            if item["area_ratio"] > 0.015:
                penalty += 0.25
            if box["width"] > int(w * 0.45) and box["height"] < int(h * 0.07):
                penalty += 0.16
            if box["height"] > int(h * 0.30) and box["width"] < int(w * 0.12):
                penalty += 0.10
            frame_ratio = min(
                cx / float(max(1, w)),
                (w - cx) / float(max(1, w)),
                cy / float(max(1, h)),
                (h - cy) / float(max(1, h)),
            )
            if frame_ratio < 0.03:
                penalty += 0.10
            rescored.append(
                {
                    "bbox": box,
                    "score": max(0.0, item["score"] - penalty),
                }
            )
        ranked = sorted(rescored, key=lambda item: item["score"], reverse=True)
        diverse: list[dict] = []
        spill: list[dict] = []
        x_bins = 6
        y_bins = 5
        bins = [[0 for _ in range(x_bins)] for _ in range(y_bins)]
        cap_per_cell = max(1, int(math.ceil(limit / float(x_bins * y_bins) * 2.2)))
        for item in ranked:
            crowded = False
            for chosen in diverse:
                d = center_dist(item, chosen)
                # Encourage spatial spread; allow close neighbors only with very low overlap.
                if d < 62 and iou(item, chosen) > 0.06:
                    crowded = True
                    break
                if d < 34:
                    crowded = True
                    break
            if crowded:
                spill.append(item)
                continue
            cx, cy = center(item["bbox"])
            bx = min(x_bins - 1, max(0, int((cx / max(1, w)) * x_bins)))
            by = min(y_bins - 1, max(0, int((cy / max(1, h)) * y_bins)))
            if bins[by][bx] >= cap_per_cell:
                spill.append(item)
                continue
            bins[by][bx] += 1
            diverse.append(item)
            if len(diverse) >= limit:
                break
        if len(diverse) < limit:
            for item in spill:
                cx, cy = center(item["bbox"])
                bx = min(x_bins - 1, max(0, int((cx / max(1, w)) * x_bins)))
                by = min(y_bins - 1, max(0, int((cy / max(1, h)) * y_bins)))
                if bins[by][bx] >= cap_per_cell + 1:
                    continue
                bins[by][bx] += 1
                diverse.append(item)
                if len(diverse) >= limit:
                    break
        keep = sorted(diverse[:limit], key=lambda item: item["score"], reverse=True)
        slim = []
        for item in keep:
            box = item["bbox"]
            if box["width"] > int(w * 0.16) and box["height"] < int(h * 0.09):
                continue
            slim.append(item)
        keep = slim[:limit]

    out: list[dict] = []
    for i, item in enumerate(keep):
        box = item["bbox"]
        cx = int(round(box["x"] + box["width"] / 2.0))
        cy = int(round(box["y"] + box["height"] / 2.0))
        out.append(
            {
                "id": f"cv_{i + 1:03d}",
                "x": cx,
                "y": cy,
                "bbox": box,
                "score": float(round(item["score"], 6)),
            }
        )

    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="OpenCV candidate region detector for GUI screenshots.")
    parser.add_argument("--input", required=True, help="Input image path.")
    parser.add_argument("--output", required=True, help="Output JSON path.")
    parser.add_argument("--max", dest="max_count", type=int, default=80, help="Max candidates.")
    args = parser.parse_args()

    image = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if image is None:
        payload = {"width": 0, "height": 0, "candidates": [], "error": "read_failed"}
        with open(args.output, "w", encoding="utf-8") as file:
            json.dump(payload, file)
        return 2

    h, w = image.shape[:2]
    limit = max(1, min(200, int(args.max_count)))
    payload = {
        "width": int(w),
        "height": int(h),
        "candidates": detect(image, limit),
        "source": "python-opencv",
    }
    with open(args.output, "w", encoding="utf-8") as file:
        json.dump(payload, file)
    return 0


if __name__ == "__main__":
    sys.exit(main())
