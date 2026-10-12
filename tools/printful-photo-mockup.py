#!/usr/bin/env python3
"""HQ #89: our design on the REAL Printful blank photo (Printful's public catalog product photos, read-only GET of
api.printful.com/products/<id>; no API key, no account, no order). Placement is approximate: the art goes in a
chest/front box tuned by hand for each catalog photo, shaded by the fabric's own folds. This is not a Printful mockup
generator render (that needs a store API key). The wall labels these "ON REAL PRINTFUL BLANK PHOTO".
  python3 tools/printful-photo-mockup.py <cards.json> <outdir> [card ids...]   -> <outdir>/<id>.jpg + index.json
Skips Tapstitch cards (no public catalog photos), all-over-print items and blanks we haven't calibrated a box for.
"""
import json, os, sys, subprocess, importlib.util
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('mc', os.path.join(HERE, 'mockup-composite.py')); mc = importlib.util.module_from_spec(spec)
sys.argv_saved = sys.argv; spec.loader.exec_module(mc)
CARDS = sys.argv[1]; OUT = sys.argv[2]; ONLY = set(sys.argv[3:])
CACHE = os.path.expanduser('~/.config/grok-bot-hq/design-train/pf-catalog'); os.makedirs(CACHE, exist_ok=True)
# catalog product id by the blank's model token
MODEL = [('1717', 586), ('6014', 753), ('1566', 839), ('6400', 360), ('6110GD', 1578), ('SASW036', 819), ('SASW035', 832), ('3001Y', 307), ('6245CM', 206), ('MUG', 19)]
# print box (x0, y0, x1, y1) on the 700x1000 catalog photo + square crop (size, center y) so the product fills the card
BOX = { 586: ((228, 335, 472, 575), (600, 470)), 753: ((235, 345, 450, 545), (600, 470)), 839: ((228, 285, 462, 500), (700, 450)),
        360: ((292, 215, 440, 340), (420, 300)), 1578: ((225, 290, 478, 530), (700, 430)), 819: ((238, 275, 462, 470), (700, 430)),
        832: ((248, 292, 420, 418), (430, 330)), 307: ((245, 375, 465, 585), (560, 470)), 206: ((262, 300, 440, 455), (640, 370)),
        19: ((255, 345, 515, 670), (700, 470)) }
FALLBACK_COLORS = ['White', 'Natural', 'Ivory', 'Vintage White', 'Navy', 'Khaki', 'Stone']

def curl(url, fn):
    if not os.path.exists(fn) or os.path.getsize(fn) < 500:
        subprocess.run(['curl', '-s', '-m', '40', '-A', 'Mozilla/5.0 (bot-office mockups)', '-o', fn, url], check=False)
    return fn if os.path.exists(fn) and os.path.getsize(fn) > 500 else None
def product(pid):
    fn = f'{CACHE}/p{pid}.json'; curl(f'https://api.printful.com/products/{pid}', fn)
    try: return json.load(open(fn))['result']
    except Exception: return None
def pid_for(card):
    pf = card.get('printful') or {}
    if pf.get('catalog_id'): return int(pf['catalog_id'])
    s = f"{pf.get('blank', '')} {pf.get('name', '')}".upper()
    if 'ALL-OVER' in s or 'AOP' in s: return None
    for tok, pid in MODEL:
        if tok in s: return pid
    return None

def build(card):
    if not card.get('printful'): return None, 'not Printful'
    pid = pid_for(card)
    if not pid or pid not in BOX: return None, 'no calibrated catalog photo'
    pr = product(pid)
    if not pr: return None, 'catalog fetch failed'
    sp = mc.SPEC.get(card['id']); want = sp[0] if sp else None; ink = sp[2] if sp else 'navy'
    t = (card.get('product_type') or '').lower()
    if t == 'hat' and sp: ink = None
    colors = {}
    for v in pr['variants']: colors.setdefault(v['color'], v['image'])
    alias = {'Navy': ['Navy', 'Washed Navy', 'True Navy', 'French Navy'], 'True Navy': ['True Navy', 'Navy'], 'Ivory': ['Ivory', 'Vintage White', 'White'], 'Heather Grey': ['Cool Heather Grey', 'Athletic Heather', 'Grey']}
    tries = ([*alias.get(want, [want])] if want else []) + FALLBACK_COLORS
    color = next((c for c in tries if c in colors), next(iter(colors)))
    if color != want and want: # garment color changed -> pick ink by lightness of the real color name
        ink = 'navy' if color in ('White', 'Natural', 'Ivory', 'Vintage White', 'Khaki', 'Stone', 'Cool Heather Grey', 'Heather Dust', 'Butter', 'Buttermilk') else 'cream'
        if t == 'hat': ink = None
    photo = curl(colors[color], f"{CACHE}/{pid}-{color.replace(' ', '_').replace('/', '_')}.jpg")
    if not photo: return None, 'photo fetch failed'
    base = Image.open(photo).convert('RGB')
    if base.size != (700, 1000): base = base.resize((700, 1000), Image.LANCZOS)
    art = mc.art_for(card, ink)
    if art is None: return None, 'no art'
    (x0, y0, x1, y1), (cs, cy) = BOX[pid]
    left_chest = t == 'tee' and 'left' in (card.get('title', '') + card.get('pitch', '')).lower() and 'chest' in card.get('title', '').lower()
    if left_chest: # wearer's left = image right, small badge
        bw = x1 - x0; x0, x1, y1 = x0 + bw * 0.58, x1 - bw * 0.04, y0 + (y1 - y0) * 0.36
    a = art.convert('RGBA'); bb = a.split()[-1].getbbox(); a = a.crop(bb) if bb else a
    bw, bh = x1 - x0, y1 - y0; k = min(bw / a.width, bh / a.height)
    a = a.resize((max(1, int(a.width * k)), max(1, int(a.height * k))), Image.LANCZOS)
    px, py = int(x0 + (bw - a.width) / 2), int(y0 + (bh - a.height) / 2) if t != 'mug' else int(y0 + (bh - a.height) / 2)
    # shading from the photo's own folds: luminance / its heavy blur, clipped
    L = base.convert('L').crop((px, py, px + a.width, py + a.height))
    mean = L.filter(ImageFilter.GaussianBlur(28))
    sh = ImageChops.divide(L, mean, scale=1.0 / 200.0) if False else None
    import numpy as np
    l = np.asarray(L, dtype=np.float32); m = np.asarray(mean, dtype=np.float32) + 1
    shade = np.clip(l / m, 0.72, 1.12)
    rgb = np.asarray(a.convert('RGB'), dtype=np.float32) * shade[..., None]
    al = np.asarray(a.split()[-1], dtype=np.float32) * (0.93 if t != 'hat' else 0.97)
    tex = Image.fromarray(np.clip(rgb, 0, 255).astype('uint8')); alpha = Image.fromarray(al.astype('uint8'))
    img = base.copy(); img.paste(tex, (px, py), alpha)
    # square crop around the product so it fills the card
    top = max(0, min(1000 - cs, cy - cs // 2)); lft = max(0, (700 - cs) // 2)
    img = img.crop((lft, top, lft + cs, top + cs)).resize((1000, 1000), Image.LANCZOS)
    d = ImageDraw.Draw(img, 'RGBA')
    try: f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 24)
    except Exception: f2 = ImageFont.load_default()
    model = pr['product'].get('model') or ''
    sub = f"Printful · {pr['product'].get('brand') or ''} {model} · {color}".replace('  ', ' ')
    w = d.textlength(sub, font=f2); d.rounded_rectangle([18, 18, 18 + w + 28, 58], 12, fill=(255, 255, 255, 225)); d.text((32, 24), sub, font=f2, fill='#1B2A4A')
    return img, f"{model} in {color} (Printful catalog photo #{pid})"

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True); deck = json.load(open(CARDS)); idx = {}
    for c in deck['cards'] if isinstance(deck, dict) else deck:
        if ONLY and c.get('id') not in ONLY: continue
        try: img, note = build(c)
        except Exception as e: img, note = None, f'error {e}'
        if img is None: print('skip', c.get('id'), note); continue
        p = f"{OUT}/{c['id']}.jpg"; img.convert('RGB').save(p, 'JPEG', quality=88, optimize=True); idx[c['id']] = {'path': p, 'note': note, 'kind': 'printful-photo'}
        print('ok', c['id'], note)
    old = {}
    try: old = json.load(open(f'{OUT}/index.json'))
    except Exception: pass
    old.update(idx); json.dump(old, open(f'{OUT}/index.json', 'w'), indent=1)
