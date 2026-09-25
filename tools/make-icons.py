# Generate PokerLens app icons (brass chip + ivory lens + spade) with Pillow.
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math, os
OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'icons')
os.makedirs(OUT, exist_ok=True)

def icon(size, maskable=False):
    S = size * 4  # supersample
    img = Image.new('RGB', (S, S), (12, 21, 18))
    d = ImageDraw.Draw(img)
    # felt radial glow
    glow = Image.new('L', (S, S), 0)
    gd = ImageDraw.Draw(glow)
    for i in range(60):
        r = S * (0.75 - i * 0.01)
        a = int(3 + i * 1.6)
        gd.ellipse([S/2 - r, S*0.42 - r, S/2 + r, S*0.42 + r], fill=a)
    felt = Image.new('RGB', (S, S), (33, 80, 63))
    img = Image.composite(felt, img, glow.filter(ImageFilter.GaussianBlur(S * 0.05)))
    d = ImageDraw.Draw(img)
    scale = 0.74 if maskable else 0.86
    R = S * scale / 2
    cx = cy = S / 2
    # chip body
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(217, 164, 65))
    # edge inserts
    for k in range(8):
        a0 = k * 45 - 9
        d.pieslice([cx - R, cy - R, cx + R, cy + R], a0, a0 + 18, fill=(243, 238, 226))
    ri = R * 0.80
    d.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], fill=(190, 138, 45))
    # inner felt ring + ivory lens
    r2 = R * 0.72
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=(23, 57, 45))
    r3 = R * 0.60
    d.ellipse([cx - r3, cy - r3, cx + r3, cy + r3], fill=(243, 238, 226))
    # dashed brass ring inside lens
    r4 = R * 0.52
    for k in range(36):
        a = math.radians(k * 10)
        x1, y1 = cx + r4 * math.cos(a), cy + r4 * math.sin(a)
        x2, y2 = cx + (r4 - R * 0.05) * math.cos(a), cy + (r4 - R * 0.05) * math.sin(a)
        d.line([x1, y1, x2, y2], fill=(217, 164, 65), width=max(2, int(S * 0.006)))
    # spade glyph
    font = None
    for f in ['C:/Windows/Fonts/seguisym.ttf', 'C:/Windows/Fonts/seguiemj.ttf', 'C:/Windows/Fonts/arial.ttf']:
        if os.path.exists(f):
            font = ImageFont.truetype(f, int(R * 0.95)); break
    txt = '\u2660'
    bbox = d.textbbox((0, 0), txt, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1] - R * 0.02), txt, font=font, fill=(18, 18, 22))
    return img.resize((size, size), Image.LANCZOS)

icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))
icon(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
icon(180).save(os.path.join(OUT, 'apple-touch-icon.png'))
icon(64).save(os.path.join(OUT, 'favicon-64.png'))
print('icons written to', os.path.abspath(OUT))
