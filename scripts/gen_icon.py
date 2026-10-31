#!/usr/bin/env python3
"""DynamicBoard app icon: a single letterless split-flap card on a dark
squircle — seam, hinge pins, and one amber accent strip along the bottom
edge of the card. Same artwork at every size (simple enough to survive
favicon dimensions), so the ≤64px simplification is just an optical bump.

Usage: python3 gen_icon.py SIZE OUT.png"""
import sys
from PIL import Image, ImageDraw

BG = (22, 24, 29)
FLAP_TOP = (62, 68, 78)
FLAP_BOT = (17, 19, 23)
SEAM = (0, 0, 0)
HINGE = (150, 158, 170)
ORANGE = (255, 116, 30)    # single accent


def gen(S, out):
    SS = 8
    img = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    U = S * SS

    # tiny sizes: card fills more of the frame so the seam stays >=2px
    small = S <= 64
    m = U * (0.21 if small else 0.17)
    cw = ch = U - 2 * m
    rad = cw * 0.09

    d.rounded_rectangle([0, 0, U, U], radius=U * 0.22, fill=BG)

    # one flap card: lighter top half, darker bottom half, seam, pins
    d.rounded_rectangle([m, m, m + cw, m + ch], radius=rad, fill=FLAP_TOP)
    d.rounded_rectangle([m, m + ch / 2, m + cw, m + ch], radius=rad,
                        fill=FLAP_BOT)
    # seam thickens at small sizes so it survives downsampling
    sh = U * (0.020 if S <= 48 else 0.009)
    d.rectangle([m, m + ch / 2 - sh, m + cw, m + ch / 2 + sh], fill=SEAM)
    for hx in (m + cw * 0.07, m + cw * 0.93):
        hr = cw * (0.045 if small else 0.030)
        d.ellipse([hx - hr, m + ch / 2 - hr, hx + hr, m + ch / 2 + hr],
                  fill=HINGE)

    # amber accent strip along the card's bottom edge
    d.rounded_rectangle([m + cw * 0.32, m + ch * 0.955, m + cw * 0.68,
                         m + ch], radius=U * 0.012, fill=ORANGE)

    img.resize((S, S), Image.LANCZOS).save(out)
    print(out, S)


if __name__ == "__main__":
    gen(int(sys.argv[1]), sys.argv[2])
