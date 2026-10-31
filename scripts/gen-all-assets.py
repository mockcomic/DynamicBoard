#!/usr/bin/env python3
"""Regenerate every DynamicBoard PWA asset from the flip-card icon design.

Usage:  python3 scripts/gen-all-assets.py
        (needs Pillow; re-run after design tweaks to scripts/gen-icons.py)

Rewrites: public/logo.png, every sized PNG in public/icons/, the two
maskable variants, and all apple-splash JPEGs (same dimensions as before).
"""
import sys, os, glob

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_icon
from PIL import Image

SRC = os.path.abspath(os.path.join(HERE, "..", "public"))
TMP = os.path.join(HERE, "_gen_work")
os.makedirs(TMP, exist_ok=True)

MASTER = 1024

def master_icon():
    p = os.path.join(TMP, "master.png")
    gen_icon.gen(MASTER * 2, p)
    return Image.open(p).resize((MASTER, MASTER), Image.LANCZOS)

def square(icon, size):
    return icon.resize((size, size), Image.LANCZOS)

def maskable(icon, size):
    """Full-bleed dark square with the art inside the 80% maskable safe zone."""
    out = Image.new("RGBA", (size, size), gen_icon.BG + (255,))
    inner = int(size * 0.72)
    art = icon.resize((inner, inner), Image.LANCZOS)
    out.alpha_composite(art, ((size - inner) // 2, (size - inner) // 2))
    return out

def wordmark(icon):
    """800x600 public/logo.png: icon badge centered, 'DynamicBoard' beneath."""
    from PIL import ImageDraw, ImageFont
    badge = icon.resize((320, 320), Image.LANCZOS)
    out = Image.new("RGBA", (800, 600), (255, 255, 255, 255))
    out.alpha_composite(badge, (240, 60))
    d = ImageDraw.Draw(out)
    f = ImageFont.truetype(
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 64)
    bb = d.textbbox((0, 0), "DynamicBoard", font=f)
    w = bb[2] - bb[0]
    d.text(((800 - w) / 2 - bb[0], 420), "DynamicBoard", font=f,
           fill=(35, 39, 46))
    out.save(os.path.join(SRC, "logo.png"))

def splash(icon, w, h):
    """iOS launch screen: dark canvas matching the app's #242424 theme so
    the handoff to the first screen is seamless."""
    side = min(w, h) // 3
    art = icon.resize((side, side), Image.LANCZOS)
    out = Image.new("RGB", (w, h), (11, 12, 14))
    out.paste(art, ((w - side) // 2, (h - side) // 2), art)
    out.save(os.path.join(SRC, "icons", f"apple-splash-{w}-{h}.jpg"),
             quality=86)

def main():
    icons_dir = os.path.join(SRC, "icons")
    icon = master_icon()

    for p in sorted(glob.glob(os.path.join(icons_dir, "*.png"))):
        name = os.path.basename(p)
        if "splash" in name or "maskable" in name:
            continue
        if name == "apple-icon-180.png":
            square(icon, 180).save(p); print(name); continue
        try:
            size = int(name.split(".")[0])
        except ValueError:
            continue
        square(icon, size).save(p); print(name)

    for sz in (192, 512):
        maskable(icon, sz).save(
            os.path.join(icons_dir, f"manifest-icon-{sz}.maskable.png"))
        print(f"manifest-icon-{sz}.maskable.png")

    for p in sorted(glob.glob(os.path.join(icons_dir, "apple-splash-*.jpg"))):
        base = os.path.basename(p)[len("apple-splash-"):-4]
        w, h = (int(x) for x in base.split("-"))
        splash(icon, w, h)
        print(os.path.basename(p))

    wordmark(icon)
    print("logo.png")

main()
