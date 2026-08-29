#!/usr/bin/env python3
"""Generate Tower Alfred's original gothic-noir pixel artwork.

The artwork is procedurally authored in this repository. It does not derive
from StarNet's reserved brand art or any third-party character asset.
"""
from __future__ import annotations

import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "frontend" / "assets" / "tower-alfred"
SPRITES = ROOT / "frontend" / "assets" / "sprites" / "nightwarden"
MANIFEST = ROOT / "frontend" / "assets" / "sprites" / "manifest.json"

INK = (5, 7, 13, 255)
BLACK = (10, 12, 20, 255)
SLATE = (25, 31, 47, 255)
STEEL = (48, 59, 79, 255)
MOON = (207, 218, 226, 255)
BLUE = (65, 194, 255, 255)
GOLD = (219, 169, 65, 255)
RED = (119, 31, 45, 255)


def pixel_icon() -> Image.Image:
    im = Image.new("RGBA", (128, 128), (4, 5, 11, 255))
    d = ImageDraw.Draw(im)
    # moon and clouds
    d.ellipse((71, 8, 116, 53), fill=(202, 213, 222, 255))
    d.ellipse((82, 4, 122, 45), fill=(9, 12, 23, 255))
    d.rectangle((5, 43, 123, 48), fill=(14, 19, 31, 255))
    d.rectangle((18, 37, 96, 42), fill=(20, 26, 40, 255))
    # gothic tower silhouette
    d.polygon([(31, 108), (31, 49), (39, 49), (39, 35), (47, 49), (81, 49), (89, 35), (89, 49), (97, 49), (97, 108)], fill=(11, 14, 24, 255))
    d.rectangle((43, 60, 85, 108), fill=(18, 23, 36, 255))
    d.polygon([(43, 60), (64, 41), (85, 60)], fill=(28, 34, 50, 255))
    d.rectangle((59, 70, 69, 108), fill=(7, 9, 16, 255))
    d.rectangle((60, 73, 68, 78), fill=GOLD)
    d.rectangle((47, 69, 53, 80), fill=BLUE)
    d.rectangle((75, 69, 81, 80), fill=BLUE)
    # parapets and foreground
    for x in range(7, 121, 14):
        d.rectangle((x, 96, x + 7, 103), fill=(24, 29, 43, 255))
    d.rectangle((4, 103, 124, 118), fill=(13, 16, 27, 255))
    d.rectangle((0, 118, 128, 127), fill=(1, 2, 5, 255))
    # blue signal line + gold authority point
    d.line((12, 113, 48, 113), fill=BLUE, width=2)
    d.line((80, 113, 116, 113), fill=BLUE, width=2)
    d.rectangle((61, 110, 67, 116), fill=GOLD)
    return im.resize((1024, 1024), Image.Resampling.NEAREST)


def sanctum_overlay() -> Image.Image:
    base = Image.new("RGBA", (320, 180), (0, 0, 0, 0))
    d = ImageDraw.Draw(base)
    # Upper skyline, deliberately translucent so the live station remains readable.
    d.rectangle((0, 0, 319, 31), fill=(3, 5, 11, 150))
    for x, h, w in [(0, 19, 28), (31, 26, 22), (57, 15, 34), (95, 23, 18), (118, 12, 40), (162, 27, 25), (191, 18, 33), (228, 25, 20), (252, 13, 42), (298, 22, 22)]:
        d.rectangle((x, 31 - h, x + w, 35), fill=(7, 10, 19, 195))
        if w > 25:
            d.polygon([(x + 5, 31 - h), (x + w // 2, max(0, 24 - h)), (x + w - 5, 31 - h)], fill=(10, 14, 25, 205))
    # distant illuminated windows
    for x, y in [(14, 17), (45, 22), (72, 12), (105, 18), (132, 10), (145, 21), (176, 24), (207, 14), (238, 20), (268, 9), (282, 23), (307, 17)]:
        d.rectangle((x, y, x + 1, y + 2), fill=(67, 173, 220, 170))
    # angular rain and lower ironwork
    for x in range(-20, 340, 17):
        d.line((x, 35, x - 10, 73), fill=(74, 134, 166, 45), width=1)
    d.line((0, 169, 319, 169), fill=(64, 173, 220, 95), width=1)
    for x in range(8, 320, 24):
        d.line((x, 156, x, 179), fill=(30, 40, 58, 125), width=2)
        d.polygon([(x - 4, 158), (x, 151), (x + 4, 158)], fill=(38, 48, 67, 130))
    return base.resize((1280, 720), Image.Resampling.NEAREST)


def wordmark_svg() -> str:
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 180" role="img" aria-label="Tower Alfred">
  <path fill="white" d="M14 151h1172v13H14zM30 21h18v119H30zm16 0h118v18H46zm42 18h19v101H88zm99-18h19l25 83 25-83h18l-35 119h-18zm115 0h96v18h-77v31h65v18h-65v34h79v18h-98zm127 0h71q39 0 39 34 0 24-23 31l28 54h-22l-25-49h-29v49h-19zm19 18v34h50q21 0 21-17 0-17-21-17zM568 140l42-119h24l42 119h-21l-10-31h-47l-10 31zm36-49h35l-17-54zm100-70h91v18h-72v34h63v18h-63v49h-19zm116 0h19v101h70v18h-89zm115 0h19v119h-19zm49 0h96v18h-77v31h65v18h-65v34h79v18h-98zm127 0h42q33 0 50 17 17 17 17 43t-17 43q-17 16-50 16h-42zm19 18v83h23q48 0 48-41t-48-42z"/>
  <path fill="white" d="M3 6h11v168H3zm1183 0h11v168h-11zM14 6h1172v8H14z" opacity=".55"/>
</svg>
"""


def sprite_frame(direction: str, state: str, frame: int) -> Image.Image:
    # Keep seated profile pairs exact mirrors; side-facing furniture depends on this contract.
    if state == "sit" and direction == "east":
        return sprite_frame("west", state, frame).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    im = Image.new("RGBA", (46, 46), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    step = 1 if state == "walk" and frame % 2 else 0
    bob = -1 if state in {"walk", "gesture"} and frame % 3 == 1 else 0
    cx = 23
    # shadow
    d.ellipse((15, 37, 31, 41), fill=(0, 0, 0, 95))
    # long coat / cape silhouette
    if direction in {"west", "north-west", "south-west"}:
        cape = [(18, 19+bob), (29, 17+bob), (33, 34+bob), (20, 36+bob), (15, 31+bob)]
    elif direction in {"east", "north-east", "south-east"}:
        cape = [(17, 17+bob), (28, 19+bob), (31, 31+bob), (26, 36+bob), (13, 34+bob)]
    else:
        cape = [(15, 18+bob), (31, 18+bob), (29, 36+bob), (17, 36+bob)]
    d.polygon(cape, fill=(12, 15, 26, 255), outline=(43, 52, 72, 255))
    # boots and stride (side-facing seated legs are drawn below with a readable reach)
    if state != "sit":
        d.rectangle((18-step, 34+bob, 21-step, 39+bob), fill=BLACK)
        d.rectangle((25+step, 34+bob, 28+step, 39+bob), fill=BLACK)
    # torso armour and coat lapels
    d.rectangle((18, 18+bob, 28, 31+bob), fill=SLATE)
    d.polygon([(18, 18+bob), (22, 24+bob), (20, 31+bob), (16, 29+bob)], fill=(18, 22, 35, 255))
    d.polygon([(28, 18+bob), (24, 24+bob), (26, 31+bob), (30, 29+bob)], fill=(18, 22, 35, 255))
    d.rectangle((22, 20+bob, 24, 29+bob), fill=(62, 69, 82, 255))
    d.rectangle((22, 20+bob, 24, 22+bob), fill=GOLD)
    d.rectangle((18, 29+bob, 28, 31+bob), fill=BLACK)
    d.rectangle((22, 29+bob, 24, 31+bob), fill=GOLD)
    # hood, deliberately original: rounded cowl with iron side fins, no bat silhouette
    d.polygon([(17, 10+bob), (20, 6+bob), (26, 6+bob), (29, 10+bob), (29, 18+bob), (17, 18+bob)], fill=(15, 19, 31, 255), outline=STEEL)
    d.rectangle((19, 11+bob, 27, 17+bob), fill=(5, 7, 13, 255))
    if direction != "north":
        if state == "blink":
            d.line((20, 13+bob, 26, 13+bob), fill=(40, 91, 119, 255), width=1)
        elif direction in {"east", "north-east", "south-east"}:
            d.rectangle((24, 12+bob, 27, 13+bob), fill=BLUE)
        elif direction in {"west", "north-west", "south-west"}:
            d.rectangle((19, 12+bob, 22, 13+bob), fill=BLUE)
        else:
            d.rectangle((19, 12+bob, 22, 13+bob), fill=BLUE)
            d.rectangle((24, 12+bob, 27, 13+bob), fill=BLUE)
    # arms; gesture raises one hand, typing projects blue controls
    arm_y = 21+bob
    d.rectangle((14, arm_y, 18, arm_y+9), fill=(18, 22, 35, 255))
    d.rectangle((28, arm_y, 32, arm_y+9), fill=(18, 22, 35, 255))
    if state == "gesture":
        lift = max(0, 7 - min(frame, 7))
        d.rectangle((30, 13+lift+bob, 33, 24+bob), fill=(24, 29, 43, 255))
        d.rectangle((31, 11+lift+bob, 33, 14+lift+bob), fill=MOON)
    if state == "talk" and frame % 2:
        d.rectangle((22, 16+bob, 24, 16+bob), fill=(154, 167, 174, 255))
    if state == "type":
        d.rectangle((15, 30, 31, 31), fill=(42, 158, 211, 180))
        d.rectangle((18 + (frame % 4) * 3, 28, 19 + (frame % 4) * 3, 29), fill=BLUE)
    if state == "sit":
        # A profile sitter needs a directional thigh and shin; symmetric feet read as facing nowhere.
        if direction in {"west", "north-west", "south-west"}:
            d.rectangle((12, 31, 24, 35), fill=(10, 13, 22, 255))
            d.rectangle((11, 34, 15, 40), fill=BLACK)
            d.rectangle((9, 39, 16, 41), fill=BLACK)
        elif direction in {"east", "north-east", "south-east"}:
            d.rectangle((22, 31, 34, 35), fill=(10, 13, 22, 255))
            d.rectangle((31, 34, 35, 40), fill=BLACK)
            d.rectangle((30, 39, 37, 41), fill=BLACK)
        else:
            d.rectangle((17, 33, 29, 38), fill=(10, 13, 22, 255))
    return im.resize((92, 92), Image.Resampling.NEAREST)


def build_sprites() -> dict[str, list[str]]:
    raw = MANIFEST.read_bytes()
    text = raw.decode("utf-8-sig")
    data = json.loads(text)
    source = {k: v for k, v in data["sprites"].items() if k.startswith("blank.")}
    generated: dict[str, list[str]] = {}
    SPRITES.mkdir(parents=True, exist_ok=True)
    for source_key, files in source.items():
        _, state, direction = source_key.split(".", 2)
        key = f"nightwarden.{state}.{direction}"
        out_files = []
        for index, _ in enumerate(files):
            suffix = f"_{index}" if len(files) > 1 else ""
            filename = f"{state}_{direction}{suffix}.png"
            sprite_frame(direction, state, index).save(SPRITES / filename)
            out_files.append(f"nightwarden/{filename}")
        generated[key] = out_files

    existing = {key for key in data["sprites"] if key.startswith("nightwarden.")}
    expected = set(generated)
    if existing and existing != expected:
        raise RuntimeError("partial Night Warden manifest detected; refusing to rewrite unrelated sprite metadata")
    if not existing:
        marker = "\r\n  }\r\n}" if "\r\n  }\r\n}" in text else "\n  }\n}"
        if marker not in text:
            raise RuntimeError("sprite manifest closing structure is not recognized")
        serialized = json.dumps(generated, indent=2, ensure_ascii=False).splitlines()[1:-1]
        block = "\n".join("  " + line for line in serialized)
        text = text.replace(marker, ",\n" + block + marker, 1)
        MANIFEST.write_bytes(text.encode("utf-8"))
    return generated


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    pixel_icon().save(ASSETS / "tower-alfred-icon.png")
    sanctum_overlay().save(ASSETS / "sanctum-overlay.png")
    (ASSETS / "tower-alfred-wordmark.svg").write_text(wordmark_svg(), encoding="utf-8")
    generated = build_sprites()
    print(json.dumps({
        "icon": str(ASSETS / "tower-alfred-icon.png"),
        "overlay": str(ASSETS / "sanctum-overlay.png"),
        "wordmark": str(ASSETS / "tower-alfred-wordmark.svg"),
        "sprite_keys": len(generated),
        "sprite_files": sum(len(v) for v in generated.values()),
    }))


if __name__ == "__main__":
    main()
