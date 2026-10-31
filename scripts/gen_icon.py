#!/usr/bin/env python3
"""Generate DynamicBoard app icon: dark rounded square, flip-card tile grid
spelling D/B with bold accent tiles, one tile mid-flip for motion."""
import sys
from PIL import Image, ImageDraw, ImageFont

BG = (35, 39, 46)          # charcoal (brand circle color)
BOARD = (52, 58, 68)       # slightly lighter board face
TILE = (17, 20, 24)        # letter tile (near-black, like a Vestaboard)
WHITE = (248, 249, 250)
ORANGE = (235, 100, 40)    # bold accents
TEAL = (38, 166, 154)
YELLOW = (240, 190, 60)
RED = (200, 60, 60)

def font(sz):
    return ImageFont.truetype(
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", sz)

def tile(draw, x, y, w, h, r, color, letter=None, fnt=None, lcolor=WHITE):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=color)
    if letter:
        bb = draw.textbbox((0, 0), letter, font=fnt)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        draw.text((x + (w - tw) / 2 - bb[0], y + (h - th) / 2 - bb[1]),
                  letter, font=fnt, fill=lcolor)

def gen(S, out):
    SS = 8  # supersample
    img = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    U = S * SS  # unit = icon size

    # tiny sizes (favicons): grid+letters can't survive; render a bold DB
    # monogram on the dark squircle instead.
    if S <= 64:
        d.rounded_rectangle([0, 0, U, U], radius=U * 0.22, fill=BG)
        f = font(int(U * 0.52))
        bb = d.textbbox((0, 0), "DB", font=f)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        # accent underline tile echoing the board motif
        d.rounded_rectangle(
            [U * 0.30, U * 0.78, U * 0.70, U * 0.85], radius=U * 0.03,
            fill=ORANGE)
        d.text(((U - w) / 2 - bb[0], (U * 0.90 - h) / 2 - bb[1]), "DB",
               font=f, fill=WHITE)
        img = img.resize((S, S), Image.LANCZOS)
        img.save(out)
        print(out, S)
        return

    small = S <= 96

    # rounded-square background
    d.rounded_rectangle([0, 0, U, U], radius=U * 0.22, fill=BG)

    # board face: 5 x 3 tile grid, centered, slight margin
    cols, rows = 5, 3
    margin = U * (0.13 if small else 0.10)
    gap = U * (0.03 if small else 0.022)
    bw = U - 2 * margin
    bh = bw * rows / cols
    bx = margin
    by = (U - bh) / 2
    d.rounded_rectangle([bx - gap, by - gap, bx + bw + gap, by + bh + gap],
                        radius=U * 0.045, fill=BOARD)

    tw = (bw - gap * (cols - 1)) / cols
    th = (bh - gap * (rows - 1)) / rows
    r = U * 0.022

    def cell(c, rr):
        return bx + c * (tw + gap), by + rr * (th + gap)

    # layout (row, col) -> spec; rest are blank near-black tiles
    letters = {
        (0, 0): ("D", WHITE, TILE),
        (1, 1): ("B", WHITE, TILE),
    }
    accents = {
        (0, 2): YELLOW,
        (1, 0): TEAL,
        (2, 2): ORANGE,
        (1, 3): RED,
        (2, 4): TEAL,
        (0, 4): ORANGE,
    }
    flip = (1, 2)  # mid-flip tile on the middle row

    for rr in range(rows):
        for cc in range(cols):
            x, y = cell(cc, rr)
            if (rr, cc) in letters:
                ch, bgc, fg = letters[(rr, cc)]
                tile(d, x, y, tw, th, r, bgc, ch,
                     font(int(U * (0.34 if small else 0.24))), fg)
            elif (rr, cc) == flip and not small:
                # mid-flip: narrow sliver with a lighter face
                sw = tw * 0.34
                sx = x + (tw - sw) / 2
                d.rounded_rectangle([sx, y, sx + sw, y + th], radius=r * 0.5,
                                    fill=(90, 99, 112))
            elif (rr, cc) == flip:
                # at small sizes the sliver is mush: show a lit full tile
                tile(d, x, y, tw, th, r, (90, 99, 112))
            elif (rr, cc) in accents:
                tile(d, x, y, tw, th, r, accents[(rr, cc)])
            else:
                tile(d, x, y, tw, th, r, TILE)

    img = img.resize((S, S), Image.LANCZOS)
    img.save(out)
    print(out, S)

if __name__ == "__main__":
    gen(int(sys.argv[1]), sys.argv[2])
