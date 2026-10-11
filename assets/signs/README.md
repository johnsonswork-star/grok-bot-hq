# Bot Office — Wall / Door Signs (Dunder Mifflin Scranton vibe)

**For the 3D bot-office scene textures — NOT OnPad.** Nothing here touches /workspace/onpad or the OnPad icons.

| File | Size (viewBox) | Suggested use |
|---|---|---|
| `sign-reception.svg` | 360×150 | Reception wall/desk plaque behind the front desk: small "DUNDER MIFFLIN", big "RECEPTION", green band "PLEASE SIGN IN" |
| `sign-conference.svg` | 280×180 | Conference room door plate: "CONFERENCE / ROOM" stacked, green rule, corner screws |
| `sign-dunder-mifflin.svg` | 560×170 | Company-name wall plaque (lobby/reception wall): "DUNDER MIFFLIN", green bar, "PAPER COMPANY · SCRANTON, PA" |
| `sign-sales.svg` (bonus) | 240×120 | Sales/bullpen door plate: "SALES" with green rule, corner screws |

PNGs in `png/`: `<name>-512.png` (512 px wide), `<name>-256.png` (256 px wide), and `<name>.png` (= the 512 version). Aspect ratio matches the SVG viewBox.

## Style
- Cream face `#f3ead6`, dark brown ink/border `#2c2416`, muted Michael's-office green `#3d5c3a`, beige inner bevel `#d9ccae`, brass-ish screws `#b9ab8a`.
- Big lettering: Oswald Bold (condensed, chunky). Sublines: Liberation Sans Bold with wide tracking.
- **All text is outlined to paths** — no font dependency; renders identically in any SVG loader / texture pipeline.
- Colors are baked in (no `currentColor`). Plaque is solid; outside the rounded corners is transparent.
- Flat, slightly dated corporate plaques — no gloss, gradients, or cartoon.

## Regenerate
`/workspace/bot-office/.venv/bin/python /workspace/bot-office/gen_signs.py` (cairosvg + fonttools in that venv).
