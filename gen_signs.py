import os, cairosvg
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT = "/workspace/bot-office/assets/signs"
os.makedirs(OUT + "/png", exist_ok=True)
INK, CREAM, GREEN, EDGE = "#2c2416", "#f3ead6", "#3d5c3a", "#d9ccae"

osw = instantiateVariableFont(TTFont("/usr/share/fonts/truetype/sand-box/google/Oswald/Oswald-VariableFont_wght.ttf"), {"wght": 700})
lib = TTFont("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf")

def text_path(font, text, cx, baseline, size=None, max_w=None, cap_h=None, track=0.0, fill=INK):
    """Outline text to an SVG path centered at cx. Size by cap height (px) or font size, shrink to max_w."""
    gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
    capH = getattr(font["OS/2"], "sCapHeight", 0) or 0.7 * upm
    if cap_h: size = cap_h * upm / capH
    def width(sz):
        w = 0
        for ch in text: w += gs[cmap[ord(ch)]].width * sz / upm + track * sz
        return w - track * sz
    w = width(size)
    if max_w and w > max_w:
        size *= max_w / w; w = width(size)
    sc = size / upm; x = cx - w / 2; ds = []
    for ch in text:
        g = gs[cmap[ord(ch)]]
        pen = SVGPathPen(gs)
        g.draw(TransformPen(pen, (sc, 0, 0, -sc, x, baseline)))
        if pen.getCommands(): ds.append(pen.getCommands())
        x += g.width * sc + track * size
    return f'<path fill="{fill}" d="{" ".join(ds)}"/>', size * capH / upm

def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
            f'<title>{title}</title>\n{body}\n</svg>\n')

def plaque(w, h, r=10, border=7, screws=False):
    s = [f'<rect x="1" y="1" width="{w-2}" height="{h-2}" rx="{r}" fill="{INK}"/>',
         f'<rect x="{border}" y="{border}" width="{w-2*border}" height="{h-2*border}" rx="{max(r-4,2)}" fill="{CREAM}"/>',
         f'<rect x="{border+5}" y="{border+5}" width="{w-2*border-10}" height="{h-2*border-10}" rx="{max(r-7,1)}" fill="none" stroke="{EDGE}" stroke-width="2"/>']
    if screws:
        for sx, sy in [(border+12, border+12), (w-border-12, border+12), (border+12, h-border-12), (w-border-12, h-border-12)]:
            s.append(f'<circle cx="{sx}" cy="{sy}" r="4" fill="#b9ab8a" stroke="{INK}" stroke-width="1.5"/>')
    return s

signs = {}

# 1. Reception 360x150
W, H = 360, 150
b = plaque(W, H)
b.append(text_path(lib, "DUNDER MIFFLIN", W/2, 38, cap_h=13, track=0.18)[0])
b.append(f'<rect x="60" y="46" width="{W-120}" height="3" fill="{GREEN}"/>')
b.append(text_path(osw, "RECEPTION", W/2, 103, cap_h=46, max_w=W-60, track=0.04)[0])
b.append(f'<rect x="7" y="114" width="{W-14}" height="29" fill="{GREEN}"/>')
b.append(text_path(lib, "PLEASE SIGN IN", W/2, 136, cap_h=13, track=0.2, fill=CREAM)[0])
signs["sign-reception"] = (W, H, b, "Reception — Please sign in (Dunder Mifflin)")

# 2. Conference door plate 280x180
W, H = 280, 180
b = plaque(W, H, r=6, screws=True)
b.append(text_path(osw, "CONFERENCE", W/2, 84, cap_h=44, max_w=W-70, track=0.03)[0])
b.append(f'<rect x="70" y="99" width="{W-140}" height="5" fill="{GREEN}"/>')
b.append(text_path(osw, "ROOM", W/2, 153, cap_h=40, track=0.12)[0])
signs["sign-conference"] = (W, H, b, "Conference Room door plate")

# 3. Dunder Mifflin wall plaque 560x170
W, H = 560, 170
b = plaque(W, H, r=8, border=8)
b.append(text_path(osw, "DUNDER MIFFLIN", W/2, 96, cap_h=62, max_w=W-70, track=0.03)[0])
b.append(f'<rect x="8" y="114" width="{W-16}" height="10" fill="{GREEN}"/>')
b.append(text_path(lib, "PAPER COMPANY  \u00b7  SCRANTON, PA", W/2, 150, cap_h=15, track=0.16)[0])
signs["sign-dunder-mifflin"] = (W, H, b, "Dunder Mifflin Paper Company — Scranton, PA wall plaque")

# 4. Bonus Sales door plate 240x120
W, H = 240, 120
b = plaque(W, H, r=6, screws=True)
b.append(text_path(osw, "SALES", W/2, 76, cap_h=44, track=0.12)[0])
b.append(f'<rect x="70" y="88" width="{W-140}" height="5" fill="{GREEN}"/>')
signs["sign-sales"] = (W, H, b, "Sales door plate")

for name, (w, h, body, title) in signs.items():
    s = svg(w, h, "\n".join(body), title)
    p = f"{OUT}/{name}.svg"
    open(p, "w").write(s)
    for pw in (512, 256):
        cairosvg.svg2png(url=p, write_to=f"{OUT}/png/{name}-{pw}.png", output_width=pw)
    cairosvg.svg2png(url=p, write_to=f"{OUT}/png/{name}.png", output_width=512)
print("done")
