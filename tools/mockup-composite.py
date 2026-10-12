#!/usr/bin/env python3
"""HQ #88: best-effort product mockups for the Design Trainer wall.
Composites OUR real design art onto a drawn blank (tee / hoodie / crew / long sleeve / kids tee / dad hat / mug / AOP pajama
top) in a real catalog color for that blank. These are COMPOSITES, not Printful renders, and every image is stamped
"COMPOSITE MOCKUP". Kelly's Printful-quality mockups in designs/swipe-train/mockups/ win over these when present.
  python3 tools/mockup-composite.py [cards.json] [outdir]     -> <outdir>/<card id>.jpg  + index.json
"""
import json, os, sys, math, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont

AF = '/workspace/atom-family-clothing-co'; D = f'{AF}/designs'
CARDS = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else f'{D}/swipe-train/cards-v1.json'
OUT = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else os.path.expanduser('~/.config/grok-bot-hq/design-train/composites')
S = 2000  # draw at 2x, save 1000
NAVY, CREAM = '#1F2A44', '#EFE7D6'
# card id -> (garment color name, hex, ink variant)
SPEC = {
 'sw-001': ('Ivory', '#EDE5D2', 'navy'), 'sw-002': ('True Navy', '#25304A', 'cream'), 'sw-003': ('Khaki', '#C9B590', 'navy'),
 'sw-004': ('Natural', '#F0E9DA', 'navy'), 'sw-005': ('Navy', '#26314B', 'cream'), 'sw-006': ('French Navy', '#232D47', 'cream'),
 'sw-007': ('Heather Grey', '#B9BBBE', 'navy'), 'sw-009': ('Ivory', '#EDE5D2', 'navy'), 'sw-010': ('Natural', '#F0E9DA', 'navy'),
 'sw-011': ('White', '#F7F7F4', 'navy'), 'sw-012': ('Heather Dust', '#E2D6C6', 'navy'), 'sw-013': ('Navy', '#26314B', None),
 'sw-014': ('Spruce', '#2F4A3E', None), 'sw-015': ('White', '#FAFAFA', 'navy'), 'sw-016': ('All-over print', '#1B2A4A', None),
 'sw-018': ('Navy Blue', '#25304A', 'cream'), 'sw-019': ('Cream', '#EEE6D3', 'navy'), 'sw-020': ('White', '#F7F7F4', 'navy'),
 'sw-021': ('Navy Blue', '#25304A', 'cream'), 'sw-022': ('Ivory', '#EDE5D2', 'navy'), 'sw-023': ('Ivory', '#EDE5D2', None),
}

def hexrgb(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def P(pts, k=S/1000): return [(x * k, y * k) for x, y in pts]
def smooth_mask(polys, ellipses=(), cut=(), r=10):
    m = Image.new('L', (S, S), 0); d = ImageDraw.Draw(m)
    for p in polys: d.polygon(P(p), fill=255)
    for e in ellipses: d.ellipse([v * S / 1000 for v in e], fill=255)
    for e in cut: d.ellipse([v * S / 1000 for v in e], fill=0)
    return m.filter(ImageFilter.GaussianBlur(r)).point(lambda v: 255 if v > 127 else 0).filter(ImageFilter.GaussianBlur(1.5))
def mirror(half): return half + [(1000 - x, y) for x, y in reversed(half)]

def background():
    bg = Image.new('RGB', (S, S), '#ECEAE6'); g = Image.linear_gradient('L').resize((S, S))
    return Image.composite(Image.new('RGB', (S, S), '#D9D6D0'), bg, g.point(lambda v: v * 0.8))
def shade_for(mask, folds=()):
    """luminance map 0..255 (128 = neutral): darker near edges + soft folds + top light"""
    inner = mask.filter(ImageFilter.GaussianBlur(60))
    sh = inner.point(lambda v: int(70 + v * 0.62))  # edge falloff
    fl = Image.new('L', (S, S), 0); d = ImageDraw.Draw(fl)
    for (a, b, w, s) in folds: d.line(P([a, b]), fill=s, width=int(w * S / 1000))
    fl = fl.filter(ImageFilter.GaussianBlur(26))
    sh = ImageChops.subtract(sh, fl)
    top = Image.linear_gradient('L').resize((S, S)).point(lambda v: int(18 - v * 0.12))
    return ImageChops.add(sh, top)
def fabric(mask, color, folds=(), noise=True):
    base = Image.new('RGB', (S, S), hexrgb(color)); sh = shade_for(mask, folds)
    lum = Image.merge('RGB', [sh] * 3)
    # multiply then brighten so 200 ~ neutral
    out = ImageChops.multiply(base, lum.point(lambda v: min(255, int(v * 1.28))))
    light = sum(hexrgb(color)) / 3 > 140
    if not light: out = Image.blend(out, ImageChops.screen(out, lum.point(lambda v: max(0, v - 150))), 0.6)
    if noise:
        n = Image.effect_noise((S // 2, S // 2), 22).resize((S, S)).convert('RGB')
        out = Image.blend(out, ImageChops.overlay(out, n), 0.25)
    return out, sh
def print_on(img, sh, mask, art, box, opacity=0.96):
    """art (RGBA) fitted into box (x0,y0,x1,y1 in 1000 units), shaded with the fabric lum, clipped to garment"""
    a = art.convert('RGBA'); bb = a.split()[-1].getbbox(); a = a.crop(bb) if bb else a
    x0, y0, x1, y1 = [v * S / 1000 for v in box]; bw, bh = x1 - x0, y1 - y0
    k = min(bw / a.width, bh / a.height); a = a.resize((max(1, int(a.width * k)), max(1, int(a.height * k))), Image.LANCZOS)
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0)); layer.paste(a, (int(x0 + (bw - a.width) / 2), int(y0 + (bh - a.height) / 2)), a)
    rgb, al = layer.convert('RGB'), layer.split()[-1]
    rgb = ImageChops.multiply(rgb, Image.merge('RGB', [sh.point(lambda v: min(255, int(v * 1.25)))] * 3))
    al = ImageChops.multiply(al, mask).point(lambda v: int(v * opacity))
    img.paste(rgb, (0, 0), al)
def drop_shadow(canvas, mask, dy=26, blur=40, op=0.35):
    sm = mask.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * op))
    sh = Image.new('L', (S, S), 0); sh.paste(sm, (14, dy)); canvas.paste(Image.new('RGB', (S, S), '#3a3530'), (0, 0), sh)
def stroke(img, pts, col, w, blur=3, op=255):
    l = Image.new('L', (S, S), 0); ImageDraw.Draw(l).line(P(pts), fill=op, width=int(w * S / 1000), joint='curve')
    img.paste(Image.new('RGB', (S, S), col), (0, 0), l.filter(ImageFilter.GaussianBlur(blur)))
def darker(h, f): return '#%02x%02x%02x' % tuple(int(c * f) for c in hexrgb(h))

# ---------- garments ----------
TEE = mirror([(500, 168), (430, 160), (300, 205), (150, 300), (215, 455), (305, 405), (300, 900)])
WTEE = mirror([(500, 175), (437, 168), (318, 210), (185, 300), (240, 430), (325, 392), (305, 600), (318, 890)])
KIDS = [(x * 0.82 + 90, y * 0.82 + 110) for x, y in TEE]
LONG = mirror([(500, 168), (430, 160), (300, 205), (210, 330), (120, 830), (195, 860), (300, 470), (300, 890)])
CREW = LONG
def garment(kind, color, art=None, art_box=None, extra=None):
    img = background()
    poly = {'tee': TEE, 'wtee': WTEE, 'kids': KIDS, 'long': LONG, 'crew': CREW, 'hoodie': LONG}[kind]
    cx = 500; neck = (cx - 70, 150, cx + 70, 212) if kind != 'kids' else (cx - 58, 232, cx + 58, 284)
    ell = [(330, 70, 670, 300)] if kind == 'hoodie' else []
    mask = smooth_mask([poly], ellipses=ell)
    drop_shadow(img, mask)
    folds = [((330, 560), (360, 860), 22, 40), ((670, 560), (640, 860), 22, 40), ((420, 700), (470, 880), 14, 26), ((300, 420), (340, 470), 30, 35), ((700, 420), (660, 470), 30, 35)]
    if kind in ('long', 'crew', 'hoodie'): folds += [((210, 400), (160, 780), 16, 45), ((790, 400), (840, 780), 16, 45)]
    fab, sh = fabric(mask, color, folds)
    img.paste(fab, (0, 0), mask)
    dk = darker(color, 0.72)
    if kind == 'hoodie':
        hood_in = smooth_mask([], ellipses=[(395, 95, 605, 255)]); img.paste(Image.new('RGB', (S, S), darker(color, 0.45)), (0, 0), hood_in.filter(ImageFilter.GaussianBlur(8)))
        stroke(img, [(330, 230), (400, 290), (500, 300), (600, 290), (670, 230)], dk, 10, 4)
        for x in (470, 530): stroke(img, [(x, 290), (x - 3, 430)], '#f2efe8' if sum(hexrgb(color)) < 400 else '#e6e2da', 7, 1)
        stroke(img, [(345, 640), (390, 560), (610, 560), (655, 640), (655, 790), (345, 790), (345, 640)], dk, 6, 3)
    else:
        n = smooth_mask([], ellipses=[neck], r=4); inner = Image.new('RGB', (S, S), darker(color, 0.68)); img.paste(inner, (0, 0), n)
        e = neck; ring = Image.new('L', (S, S), 0); dr = ImageDraw.Draw(ring)
        dr.ellipse([v * S / 1000 for v in (e[0] - 12, e[1] - 10, e[2] + 12, e[3] + 14)], outline=255, width=int(24 * S / 1000))
        ring = ImageChops.multiply(ring, mask).filter(ImageFilter.GaussianBlur(2)); img.paste(Image.new('RGB', (S, S), darker(color, 0.85)), (0, 0), ring)
    if kind in ('crew',):
        for y0 in (840,): stroke(img, [(300, y0), (700, y0)], dk, 5, 3)
        stroke(img, [(140, 800), (205, 828)], dk, 5, 3); stroke(img, [(860, 800), (795, 828)], dk, 5, 3)
    if kind in ('tee', 'wtee', 'kids'):
        stroke(img, [(225, 425), (300, 385)] if kind != 'kids' else [(270, 465), (340, 430)], dk, 4, 3)
        stroke(img, [(775, 425), (700, 385)] if kind != 'kids' else [(730, 465), (660, 430)], dk, 4, 3)
    if art is not None: print_on(img, sh, mask, art, art_box)
    return img
def hat(color, art):
    img = background()
    crown = smooth_mask([], ellipses=[(220, 230, 780, 790)]); cut = Image.new('L', (S, S), 0); ImageDraw.Draw(cut).rectangle([0, 0, S, 610 * S / 1000], fill=255)
    crown = ImageChops.multiply(crown, cut)
    bill = smooth_mask([], ellipses=[(170, 540, 830, 760)])
    full = ImageChops.lighter(crown, bill); drop_shadow(img, full, 30, 50)
    fab, sh = fabric(crown, color, [((500, 240), (500, 600), 10, 50), ((360, 270), (300, 600), 8, 40), ((640, 270), (700, 600), 8, 40)])
    img.paste(fab, (0, 0), crown)
    bf, bsh = fabric(bill, darker(color, 0.9), [((200, 640), (800, 640), 30, 30)])
    img.paste(bf, (0, 0), bill)
    stroke(img, [(170, 650), (300, 600), (500, 585), (700, 600), (830, 650)], darker(color, 0.6), 5, 3)
    for k in (0.62, 0.78): stroke(img, [(210 + (1 - k) * 60, 660 + k * 30), (500, 640 + k * 50), (790 - (1 - k) * 60, 660 + k * 30)], darker(color, 0.7), 3, 2)
    stroke(img, [(500, 240), (500, 585)], darker(color, 0.7), 4, 2)
    b = smooth_mask([], ellipses=[(482, 222, 518, 252)], r=2); img.paste(Image.new('RGB', (S, S), darker(color, 0.85)), (0, 0), b)
    print_on(img, sh, crown, art, (395, 335, 605, 545), 1.0)
    return img
def mug(color, art):
    img = background()
    body = smooth_mask([[(250, 230), (690, 230), (690, 800), (250, 800)]], ellipses=[(250, 760, 690, 840)], r=6)
    handle = Image.new('L', (S, S), 0); ImageDraw.Draw(handle).ellipse([v * S / 1000 for v in (610, 360, 840, 660)], outline=255, width=int(52 * S / 1000))
    cutl = Image.new('L', (S, S), 0); ImageDraw.Draw(cutl).rectangle([690 * S / 1000, 0, S, S], fill=255); handle = ImageChops.multiply(handle, cutl).filter(ImageFilter.GaussianBlur(3))
    full = ImageChops.lighter(body, handle); drop_shadow(img, full, 30, 46)
    hf, _ = fabric(handle, color, noise=False); img.paste(hf, (0, 0), handle)
    # cylinder shading: horizontal gradient
    g = Image.linear_gradient('L').rotate(90).resize((S, S)); cyl = g.point(lambda v: int(150 + 95 * math.sin(math.pi * (255 - v) / 255 * 0.95 + 0.1)))
    base = ImageChops.multiply(Image.new('RGB', (S, S), hexrgb(color)), Image.merge('RGB', [cyl.point(lambda v: min(255, int(v * 1.08)))] * 3))
    img.paste(base, (0, 0), body)
    top = smooth_mask([], ellipses=[(250, 195, 690, 265)], r=3); img.paste(Image.new('RGB', (S, S), '#d8d8d8'), (0, 0), top)
    rim_in = smooth_mask([], ellipses=[(268, 203, 672, 258)], r=3); img.paste(Image.new('RGB', (S, S), '#b9b9b9'), (0, 0), rim_in)
    print_on(img, cyl, body, art, (300, 330, 640, 700), 1.0)
    hl = Image.new('L', (S, S), 0); ImageDraw.Draw(hl).rectangle([v * S / 1000 for v in (300, 260, 325, 790)], fill=120); img.paste(Image.new('RGB', (S, S), 'white'), (0, 0), hl.filter(ImageFilter.GaussianBlur(14)))
    return img
def pajama(pattern):
    img = background(); mask = smooth_mask([LONG]); drop_shadow(img, mask)
    pat = Image.open(pattern).convert('RGB').resize((1400, 1400)); tile = Image.new('RGB', (S, S))
    for x in range(0, S, 1400):
        for y in range(0, S, 1400): tile.paste(pat, (x, y))
    sh = shade_for(mask, [((330, 560), (360, 860), 22, 40), ((670, 560), (640, 860), 22, 40)])
    tile = ImageChops.multiply(tile, Image.merge('RGB', [sh.point(lambda v: min(255, int(v * 1.3)))] * 3))
    img.paste(tile, (0, 0), mask)
    gold = '#C9A55A'
    stroke(img, [(430, 160), (470, 300), (500, 330), (530, 300), (570, 160)], gold, 8, 1)  # piping collar
    stroke(img, [(500, 330), (500, 890)], gold, 6, 1)
    for y in (420, 540, 660, 780): b = smooth_mask([], ellipses=[(488, y - 12, 512, y + 12)], r=1); img.paste(Image.new('RGB', (S, S), '#efe7d6'), (0, 0), b)
    stroke(img, [(330, 470), (420, 470), (420, 560), (330, 560), (330, 470)], gold, 5, 1)  # chest pocket
    stroke(img, [(120, 830), (195, 860)], gold, 7, 1); stroke(img, [(880, 830), (805, 860)], gold, 7, 1)
    return img

def label(img, text, sub):
    img = img.resize((1000, 1000), Image.LANCZOS); d = ImageDraw.Draw(img, 'RGBA')
    try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 26); f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
    except Exception: f = f2 = ImageFont.load_default()
    d.rounded_rectangle([18, 18, 18 + d.textlength(text, font=f) + 28, 62], 12, fill=(27, 42, 74, 225)); d.text((32, 25), text, font=f, fill='#F3E3B5')
    w = d.textlength(sub, font=f2); d.rounded_rectangle([1000 - w - 46, 940, 982, 982], 12, fill=(255, 255, 255, 215)); d.text((1000 - w - 32, 948), sub, font=f2, fill='#1B2A4A')
    return img

def art_for(card, ink):
    files = card.get('design_files') or [card.get('thumbnail')]
    pngs = [f for f in files if f and f.startswith(D) and os.path.exists(f)]
    if ink:
        want = [f for f in pngs if f.endswith(f'-{ink}.png')]
        if not want and pngs:
            alt = pngs[0].rsplit('-', 1)[0] + f'-{ink}.png'
            if os.path.exists(alt): want = [alt]
        if want: pngs = want
    return Image.open(pngs[0]).convert('RGBA') if pngs else None

def build(card):
    cid, t = card['id'], (card.get('product_type') or '').lower(); spec = SPEC.get(cid)
    so = card.get('printful') or card.get('tapstitch') or {}; blank = so.get('blank') or (('Tapstitch #' + so['sku']) if so.get('sku') else '')
    if t == 'underwear':
        f = card.get('thumbnail'); return (Image.open(f).convert('RGB').resize((1000, 1000)), 'existing designer mockup') if f and os.path.exists(f) else (None, '')
    if not spec:  # new card from Kelly: safe default colors (navy ink on a light blank, navy hat)
        spec = ('Navy', '#26314B', None) if t == 'hat' else ('White', '#F7F7F4', 'navy')
    cname, col, ink = spec; art = art_for(card, ink)
    if t == 'sleepwear':
        f = card.get('thumbnail'); img = pajama(f)
    elif t == 'hat': img = hat(col, art)
    elif t == 'mug': img = mug(col, art)
    elif t == 'tee' and 'left' in (card.get('title', '') + card.get('pitch', '')).lower() and 'chest' in card.get('title', '').lower():
        img = garment('tee', col, art, (590, 250, 680, 340))
    else:
        kind = {'tee': 'tee', 'womens_tee': 'wtee', 'kids_tee': 'kids', 'crewneck': 'crew', 'hoodie': 'hoodie', 'long_sleeve': 'long'}.get(t)
        if not kind: return None, ''
        box = {'kids': (370, 330, 630, 520), 'hoodie': (345, 330, 655, 530)}.get(kind, (340, 265, 660, 520))
        img = garment(kind, col, art, box)
    sup = 'Printful' if card.get('printful') else 'Tapstitch'
    bl = blank if blank.lower().startswith(sup.lower()) else f'{sup} · {blank}'
    return label(img, 'COMPOSITE MOCKUP', f'{bl} · {cname}'), f'{blank} in {cname}'

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True); deck = json.load(open(CARDS)); idx = {}
    only = set(sys.argv[3:])
    for c in deck['cards']:
        if only and c['id'] not in only: continue
        img, note = build(c)
        if img is None: print('skip', c['id']); continue
        p = f"{OUT}/{c['id']}.jpg"; img.convert('RGB').save(p, 'JPEG', quality=88, optimize=True); idx[c['id']] = {'path': p, 'note': note, 'kind': 'composite'}
        print('ok', c['id'], note)
    old = {}
    try: old = json.load(open(f'{OUT}/index.json'))
    except Exception: pass
    old.update(idx); json.dump(old, open(f'{OUT}/index.json', 'w'), indent=1)
