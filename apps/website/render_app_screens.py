#!/usr/bin/env python3
"""
Faithful static captures of the real NearbyOrders customer app UI.

Source of truth: ~/workspace/NearbyOrders/apps/mobile/src
  screens/Home.tsx, Explore.tsx, Orders.tsx, Bookings.tsx,
  BookService.tsx, Cart.tsx, components/ui.tsx, styles.css, main.tsx

Every layout, token, label, and piece of copy below is taken from the actual
implemented app. Nothing is invented as a "new screen": these are the real
customer screens (Home / Explore / Orders / Bookings / Cart / Book a service)
rendered as static images.

Runtime data (business names, prices, ratings, dates) is clearly fictional
demo data. It does not represent real users or real businesses.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "screens")
W, H = 600, 1228  # phone frame ratio 300:614

import os
# Font locations: override with NO_BRICALAGE_FONT / NO_INTER_FONT in another
# environment. Defaults point at the NearbyOrders mobile repo fonts.
BRIC = os.environ.get("NO_BRICOLAGE_FONT", "/home/hatch/workspace/NearbyOrders/apps/mobile/public/fonts/BricolageGrotesque-Variable.woff2")
INTER = os.environ.get("NO_INTER_FONT", "/home/hatch/.fonts/Inter-Regular.ttf")

# ---- Design tokens (apps/mobile/src/styles.css :root) ----
PORCELAIN = (242, 245, 247)
CARD = (255, 255, 255)
BORDER = (227, 233, 239)
BORDER_STRONG = (203, 213, 221)
INK = (22, 34, 46)
INK2 = (51, 70, 90)
MUTED = (92, 110, 128)
EMBER = (226, 58, 46)
BRAND_SOFT = (232, 238, 243)
SUCCESS = (34, 118, 63)
SUCCESS_SOFT = (235, 244, 236)
GOLD = (168, 118, 28)
PREP_BG = (225, 240, 250)
PREP_FG = (3, 105, 161)
PEND_BG = (250, 240, 220)
PEND_FG = (168, 99, 10)
CONF_BG = (232, 243, 234)

_font_cache = {}
def font(display: bool, weight: int, size: int):
    key = (display, weight, size)
    if key not in _font_cache:
        f = ImageFont.truetype(BRIC if display else INTER, size)
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
        _font_cache[key] = f
    return _font_cache[key]

def tracked(draw, xy, text, fnt, fill, ls=0):
    """Draw text with letter-spacing (for tight display headings)."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + ls
    return x

def rr(draw, box, r, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)

def line(draw, a, b, fill, width=1):
    draw.line([a, b], fill=fill, width=width)

# ---------------------------------------------------------------- icons
def i_search(d, cx, cy, s, color, w=3):
    r = s * 0.32
    d.ellipse([cx - r, cy - r - s*0.06, cx + r, cy + r - s*0.06], outline=color, width=w)
    d.line([cx + r*0.7, cy + r*0.62, cx + s*0.42, cy + s*0.42], fill=color, width=w)

def i_pin(d, cx, cy, s, color, w=3):
    r = s * 0.30
    d.ellipse([cx - r, cy - r - s*0.12, cx + r, cy + r - s*0.12], outline=color, width=w)
    d.polygon([(cx - r*0.72, cy + r*0.42), (cx + r*0.72, cy + r*0.42), (cx, cy + s*0.44)], outline=color)
    dot = s * 0.08
    d.ellipse([cx - dot, cy - s*0.12 - dot, cx + dot, cy - s*0.12 + dot], fill=color)

def i_home(d, cx, cy, s, color, w=3):
    p = [(cx - s*0.38, cy + s*0.02), (cx, cy - s*0.34), (cx + s*0.38, cy + s*0.02),
         (cx + s*0.28, cy + s*0.02), (cx + s*0.28, cy + s*0.36),
         (cx - s*0.28, cy + s*0.36), (cx - s*0.28, cy + s*0.02)]
    d.line(p, fill=color, width=w, joint="curve")

def i_receipt(d, cx, cy, s, color, w=3):
    x0, y0, x1, y1 = cx - s*0.26, cy - s*0.36, cx + s*0.26, cy + s*0.36
    d.rounded_rectangle([x0, y0, x1, y1], radius=s*0.08, outline=color, width=w)
    for i, yy in enumerate([cy - s*0.12, cy + s*0.02, cy + s*0.16]):
        d.line([(x0 + s*0.12, yy), (x1 - s*0.12 - (s*0.1 if i == 2 else 0), yy)], fill=color, width=max(2, w-1))

def i_cal(d, cx, cy, s, color, w=3):
    x0, y0, x1, y1 = cx - s*0.3, cy - s*0.26, cx + s*0.3, cy + s*0.34
    d.rounded_rectangle([x0, y0, x1, y1], radius=s*0.08, outline=color, width=w)
    d.line([(x0, cy - s*0.08), (x1, cy - s*0.08)], fill=color, width=w)
    for tx in (cx - s*0.15, cx + s*0.15):
        d.line([(tx, y0 - s*0.1), (tx, y0 + s*0.06)], fill=color, width=w)

def i_person(d, cx, cy, s, color, w=3):
    r = s * 0.16
    d.ellipse([cx - r, cy - s*0.3, cx + r, cy - s*0.3 + 2*r], outline=color, width=w)
    d.arc([cx - s*0.28, cy - s*0.12, cx + s*0.28, cy + s*0.44], start=200, end=340, fill=color, width=w)

def i_bell(d, cx, cy, s, color, w=3):
    d.arc([cx - s*0.24, cy - s*0.3, cx + s*0.24, cy + s*0.18], start=180, end=360, fill=color, width=w)
    d.line([(cx - s*0.24, cy - s*0.06), (cx - s*0.3, cy + s*0.22)], fill=color, width=w)
    d.line([(cx + s*0.24, cy - s*0.06), (cx + s*0.3, cy + s*0.22)], fill=color, width=w)
    d.line([(cx - s*0.3, cy + s*0.22), (cx + s*0.3, cy + s*0.22)], fill=color, width=w)
    r = s*0.07
    d.ellipse([cx - r, cy + s*0.3 - r, cx + r, cy + s*0.3 + r], fill=color)

def i_star(d, cx, cy, s, color):
    import math
    pts = []
    for i in range(10):
        ang = -math.pi/2 + i * math.pi/5
        rad = s*0.5 if i % 2 == 0 else s*0.22
        pts.append((cx + rad*math.cos(ang), cy + rad*math.sin(ang)))
    d.polygon(pts, fill=color)

def i_chev(d, cx, cy, s, color, w=3):
    d.line([(cx - s*0.14, cy - s*0.22), (cx + s*0.14, cy)], fill=color, width=w)
    d.line([(cx + s*0.14, cy), (cx - s*0.14, cy + s*0.22)], fill=color, width=w)

def i_check(d, cx, cy, s, color, w=4):
    d.line([(cx - s*0.3, cy + s*0.02), (cx - s*0.06, cy + s*0.26)], fill=color, width=w)
    d.line([(cx - s*0.06, cy + s*0.26), (cx + s*0.32, cy - s*0.24)], fill=color, width=w)

def i_back(d, cx, cy, s, color, w=3):
    d.line([(cx + s*0.16, cy - s*0.24), (cx - s*0.16, cy)], fill=color, width=w)
    d.line([(cx - s*0.16, cy), (cx + s*0.16, cy + s*0.24)], fill=color, width=w)

# ---------------------------------------------------------------- chrome
def status_bar(d):
    d.text((36, 22), "9:41", font=font(False, 600, 24), fill=INK)
    x = W - 36
    # battery
    d.rounded_rectangle([x - 52, 26, x - 8, 48], radius=7, outline=MUTED, width=2)
    d.rectangle([x - 48, 30, x - 20, 44], fill=MUTED)
    d.rectangle([x - 4, 32, x, 42], fill=MUTED)
    # wifi arcs
    cx = x - 76
    for r in (6, 12, 18):
        d.arc([cx - r, 44 - r, cx + r, 44 + r], start=225, end=315, fill=INK, width=3)
    d.ellipse([cx - 3, 41, cx + 3, 47], fill=INK)
    # signal bars
    bx = x - 128
    for i, h in enumerate((10, 16, 22, 28)):
        d.rectangle([bx + i*11, 50 - h, bx + i*11 + 7, 50], fill=INK)

def meridian_mark(d, x, y, s):
    """Simplified Meridian N: bold slate N, ember diagonal resolving to a point."""
    f = font(True, 800, s)
    d.text((x, y), "N", font=f, fill=INK)
    w = d.textlength("N", font=f)
    yb = y + s * 1.02
    d.polygon([(x + 2, yb), (x + w * 0.62, yb - s*0.16), (x + w*0.62, yb - s*0.06), (x + 2, yb + s*0.1)], fill=EMBER)
    pr = s * 0.11
    px, py = x + w * 0.78, yb - s * 0.19
    d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=EMBER)

def app_header(d, y=54):
    meridian_mark(d, 30, y + 8, 40)
    d.text((84, y + 16), "Nearby", font=font(True, 600, 30), fill=INK)
    w = d.textlength("Nearby", font=font(True, 600, 30))
    d.text((84 + w, y + 16), "Orders", font=font(True, 800, 30), fill=EMBER)
    i_bell(d, W - 52, y + 38, 40, INK)
    return y + 76

def bottom_nav(d, active=0):
    y0 = H - 108
    rr(d, [15, y0, W - 15, y0 + 92], 30, fill=CARD, outline=BORDER, width=2)
    labels = ["Home", "Explore", "Orders", "Bookings", "Profile"]
    icons = [i_home, i_search, i_receipt, i_cal, i_person]
    cw = (W - 30) / 5
    for i, (lab, ic) in enumerate(zip(labels, icons)):
        cx = 15 + cw * (i + 0.5)
        if i == active:
            rr(d, [cx - 52, y0 + 12, cx + 52, y0 + 80], 20, fill=BRAND_SOFT)
            ic(d, cx, y0 + 36, 34, EMBER)
            d.text((cx - d.textlength(lab, font=font(False, 800, 17)) / 2, y0 + 54),
                   lab, font=font(False, 800, 17), fill=INK)
        else:
            ic(d, cx, y0 + 36, 34, MUTED)
            d.text((cx - d.textlength(lab, font=font(False, 700, 17)) / 2, y0 + 54),
                   lab, font=font(False, 700, 17), fill=MUTED)

# ------------------------------------------------------- shared content
PX = 30  # screen side padding

def section_header(d, y, title, action=None, action_color=EMBER):
    d.text((PX, y), title, font=font(True, 800, 27), fill=INK)
    if action:
        f = font(False, 700, 20)
        d.text((W - PX - d.textlength(action, font=f), y + 4), action, font=f, fill=action_color)
    return y + 44

def biz_row(d, y, name, category, rating, distance, open_now, desc=None):
    ts = 96  # thumb
    rr(d, [PX, y, PX + ts, y + ts], 20, fill=INK)
    f = font(True, 800, 34)
    ch = name[0].upper()
    d.text((PX + (ts - d.textlength(ch, font=f)) / 2, y + (ts - 40) / 2), ch, font=f, fill=CARD)
    tx = PX + ts + 20
    d.text((tx, y + 2), name, font=font(True, 800, 23), fill=INK)
    my = y + 34
    x = tx
    i_star(d, x + 10, my + 11, 20, GOLD)
    x += 26
    rt = f"{rating:.1f}"
    d.text((x, my), rt, font=font(False, 700, 19), fill=GOLD)
    x += d.textlength(rt, font=font(False, 700, 19)) + 12
    for part, col in [(category, MUTED), (distance, MUTED)]:
        d.text((x, my), part, font=font(False, 600, 19), fill=col)
        x += d.textlength(part, font=font(False, 600, 19)) + 12
    d.text((x, my), "Open" if open_now else "Closed",
           font=font(False, 700, 19), fill=SUCCESS if open_now else MUTED)
    if desc:
        f2 = font(False, 400, 18)
        dd = desc if len(desc) < 52 else desc[:50] + "\u2026"
        d.text((tx, my + 26), dd, font=f2, fill=MUTED)
    i_chev(d, W - PX - 12, y + ts / 2, 26, MUTED)
    line(d, (PX, y + ts + 16), (W - PX, y + ts + 16), BORDER, 2)
    return y + ts + 34

def track_dots(d, x, y, done):
    """OrderTrack: 5 dots, connectors; done steps green, current ringed."""
    for i in range(5):
        cx = x + i * 40
        if i > 0:
            line(d, (cx - 32, y), (cx - 8, y), SUCCESS if i <= done else BORDER_STRONG, 3)
        if i < done:
            d.ellipse([cx - 8, y - 8, cx + 8, y + 8], fill=SUCCESS)
        elif i == done:
            d.ellipse([cx - 8, y - 8, cx + 8, y + 8], fill=SUCCESS)
            d.ellipse([cx - 13, y - 13, cx + 13, y + 13], outline=SUCCESS, width=3)
        else:
            d.ellipse([cx - 8, y - 8, cx + 8, y + 8], fill=BORDER_STRONG)

def badge_w(d, text):
    return d.textlength(text, font=font(False, 700, 18)) + 28

def badge(d, x, y, text, bg, fg):
    f = font(False, 700, 18)
    w = d.textlength(text, font=f) + 28
    rr(d, [x, y, x + w, y + 34], 17, fill=bg)
    d.text((x + 14, y + 5), text, font=f, fill=fg)
    return w

def order_card(d, y, name, number, items, total, status_text, status_bg, status_fg, done):
    top = y
    rr(d, [PX, y, W - PX, y + 218], 24, fill=CARD, outline=BORDER, width=2)
    ts = 78
    rr(d, [PX + 22, y + 20, PX + 22 + ts, y + 20 + ts], 20, fill=INK)
    f = font(True, 800, 32)
    ch = name[0].upper()
    d.text((PX + 22 + (ts - d.textlength(ch, font=f)) / 2, y + 20 + (ts - 38) / 2), ch, font=f, fill=CARD)
    tx = PX + 22 + ts + 18
    d.text((tx, y + 24), name, font=font(True, 800, 22), fill=INK)
    d.text((tx, y + 54), f"{number} \u00b7 {items}", font=font(False, 400, 19), fill=MUTED)
    tf = font(True, 800, 22)
    d.text((W - PX - 22 - d.textlength(total, font=tf), y + 24), total, font=tf, fill=INK)
    track_dots(d, PX + 24, y + 138, done)
    bw = badge_w(d, status_text)
    badge(d, W - PX - 22 - bw, y + 122, status_text, status_bg, status_fg)
    rr(d, [PX, y + 168, W - PX, y + 218], 24, fill=PORCELAIN)
    d.rectangle([PX, y + 168, W - PX, y + 192], fill=PORCELAIN)  # square top of strip
    line(d, (PX + 2, y + 168), (W - PX - 2, y + 168), BORDER, 2)
    d.text((PX + 22, y + 182), "Placed 28 Sep, 9:41 AM", font=font(False, 400, 18), fill=MUTED)
    i_chev(d, W - PX - 34, y + 193, 24, MUTED)
    rr(d, [PX, y, W - PX, y + 218], 24, outline=BORDER, width=2)  # outline over strip
    return top + 218 + 22

def booking_card(d, y, day, month, service, business, when, price, status_text, status_bg, status_fg):
    top = y
    rr(d, [PX, y, W - PX, y + 150], 24, fill=CARD, outline=BORDER, width=2)
    bw2 = 92
    rr(d, [PX + 22, y + 26, PX + 22 + bw2, y + 124], 20, fill=BRAND_SOFT, outline=BORDER, width=2)
    f = font(True, 800, 36)
    d.text((PX + 22 + (bw2 - d.textlength(day, font=f)) / 2, y + 34), day, font=f, fill=INK)
    f2 = font(False, 700, 16)
    d.text((PX + 22 + (bw2 - d.textlength(month, font=f2)) / 2, y + 78), month, font=f2, fill=MUTED)
    tx = PX + 22 + bw2 + 18
    d.text((tx, y + 26), service, font=font(True, 800, 22), fill=INK)
    d.text((tx, y + 56), business, font=font(False, 400, 19), fill=MUTED)
    d.text((tx, y + 84), when, font=font(False, 400, 19), fill=MUTED)
    tf = font(True, 800, 21)
    bw = badge_w(d, status_text)
    d.text((W - PX - 22 - max(d.textlength(price, font=tf), bw), y + 30), price, font=tf, fill=INK)
    badge(d, W - PX - 22 - bw, y + 62, status_text, status_bg, status_fg)
    return top + 150 + 20

# ------------------------------------------------------- screens
def render_home():
    img = Image.new("RGB", (W, H), PORCELAIN)
    d = ImageDraw.Draw(img)
    status_bar(d)
    y = app_header(d)  # 130
    # home-context: tappable location row (Home.tsx)
    i_pin(d, PX + 12, y + 22, 30, INK)
    d.text((PX + 32, y + 10), "Your neighborhood", font=font(False, 600, 19), fill=MUTED)
    t = "4 open now"
    f = font(False, 700, 19)
    d.text((W - PX - d.textlength(t, font=f), y + 10), t, font=f, fill=SUCCESS)
    y += 52
    # home-hero: daypart greeting + editorial title + search entry
    d.text((PX, y), "Good morning,", font=font(False, 700, 19), fill=MUTED)
    y += 34
    tracked(d, (PX, y), "Find the best", font(True, 800, 50), INK, ls=-1)
    y += 58
    tracked(d, (PX, y), "near you", font(True, 800, 50), INK, ls=-1)
    y += 74
    # home-hero-search entry (opens real Search; Home has no search of its own)
    rr(d, [PX, y, W - PX, y + 72], 22, fill=CARD, outline=BORDER_STRONG, width=2)
    i_search(d, PX + 38, y + 36, 38, MUTED)
    d.text((PX + 66, y + 22), "Search businesses, products & services",
           font=font(False, 400, 21), fill=MUTED)
    d.ellipse([W - PX - 62, y + 8, W - PX - 6, y + 64], fill=INK)
    i_search(d, W - PX - 34, y + 36, 32, CARD, w=4)
    y += 100
    y = section_header(d, y, "Browse categories", "See all")
    cats = [("Food", i_receipt), ("Beauty", i_person), ("Health", i_bell),
            ("Shopping", i_home), ("Fitness", i_cal)]
    x = PX
    for name, ic in cats:
        rr(d, [x, y, x + 68, y + 68], 20, fill=BRAND_SOFT)
        ic(d, x + 34, y + 34, 36, INK)
        f2 = font(False, 700, 18)
        d.text((x + (68 - d.textlength(name, font=f2)) / 2, y + 76), name, font=f2, fill=INK2)
        x += 104
    y += 132
    y = section_header(d, y, "Popular near you", "See all")
    # SpotlightCard: 116px media + body (kicker/name/place/desc)
    rr(d, [PX, y, W - PX, y + 190], 24, fill=CARD, outline=BORDER, width=2)
    rr(d, [PX, y, PX + 176, y + 190], 24, fill=INK)
    d.rectangle([PX + 100, y, PX + 176, y + 190], fill=INK)
    f3 = font(True, 800, 72)
    d.text((PX + (176 - d.textlength("D", font=f3)) / 2, y + 52), "D", font=f3, fill=CARD)
    bx = PX + 176 + 24
    tracked(d, (bx, y + 20), "OPEN NOW", font(False, 800, 16), EMBER, ls=2)
    d.text((bx, y + 44), "Demo Caf\u00e9", font=font(True, 800, 26), fill=INK)
    d.text((bx, y + 80), "Gulberg, Lahore", font=font(False, 400, 18), fill=MUTED)
    d.text((bx, y + 108), "Fresh brews and baked goods,", font=font(False, 400, 18), fill=INK2)
    d.text((bx, y + 132), "served all day.", font=font(False, 400, 18), fill=INK2)
    y += 214
    y = biz_row(d, y, "Demo Bakery", "Bakery", 4.8, "0.8 km", True)
    y = biz_row(d, y, "Demo Barbershop", "Barbershop", 4.9, "1.2 km", True)
    bottom_nav(d, active=0)
    return img

def render_explore():
    img = Image.new("RGB", (W, H), PORCELAIN)
    d = ImageDraw.Draw(img)
    status_bar(d)
    y = app_header(d)
    # explore-hero (Explore.tsx)
    tracked(d, (PX, y), "Explore", font(True, 800, 54), INK, ls=-1)
    y += 66
    d.text((PX, y), "Find businesses you can order from", font=font(False, 400, 22), fill=MUTED)
    y += 32
    d.text((PX, y), "or book, near you.", font=font(False, 400, 22), fill=MUTED)
    y += 52
    # search-bar-v3 (pill)
    rr(d, [PX, y, W - PX, y + 72], 36, fill=CARD, outline=BORDER, width=3)
    i_search(d, PX + 40, y + 36, 38, MUTED)
    d.text((PX + 68, y + 22), "Search this area", font=font(False, 400, 22), fill=MUTED)
    d.ellipse([W - PX - 70, y + 4, W - PX - 6, y + 68], fill=INK)
    i_search(d, W - PX - 38, y + 36, 32, CARD, w=4)
    y += 96
    # filter-row: Near you toggle + category chips
    x = PX
    def chip(label, active=False, icon=None):
        nonlocal x
        f = font(False, 700 if active else 600, 20)
        w = d.textlength(label, font=f) + (64 if icon else 48)
        rr(d, [x, y, x + w, y + 56], 28, fill=INK if active else CARD,
           outline=None if active else BORDER, width=2)
        tx = x + 24
        if icon:
            icon(d, tx + 12, y + 28, 30, CARD if active else INK)
            tx += 36
        d.text((tx, y + 14), label, font=f, fill=CARD if active else INK2)
        x += w + 14
    chip("Near you", icon=i_pin)
    chip("Food")
    chip("Beauty")
    chip("Health")
    y += 88
    y = section_header(d, y, "All businesses", "6 businesses", action_color=MUTED)
    y = biz_row(d, y, "Demo Caf\u00e9", "Caf\u00e9", 4.8, "0.8 km", True,
                "Fresh brews and baked goods, served all day.")
    y = biz_row(d, y, "Demo Bakery", "Bakery", 4.7, "1.1 km", True,
                "Sourdough, croissants and custom cakes.")
    y = biz_row(d, y, "Demo Salon", "Salon", 4.9, "1.4 km", False,
                "Haircuts, styling and grooming services.")
    y = biz_row(d, y, "Demo Pharmacy", "Pharmacy", 4.6, "2.0 km", True,
                "Medicines and daily essentials, delivered fast.")
    bottom_nav(d, active=1)
    return img

def render_cart():
    img = Image.new("RGB", (W, H), PORCELAIN)
    d = ImageDraw.Draw(img)
    status_bar(d)
    y = 84
    # back-link (Cart.tsx: pushed route, no tab bar)
    i_back(d, PX + 12, y + 14, 28, INK)
    d.text((PX + 34, y), "Back", font=font(False, 700, 22), fill=INK)
    y += 52
    tracked(d, (PX, y), "Your cart", font(True, 800, 44), INK, ls=-1)
    y += 62
    d.text((PX, y), "Ordering from ", font=font(False, 400, 21), fill=MUTED)
    w0 = d.textlength("Ordering from ", font=font(False, 400, 21))
    d.text((PX + w0, y), "Demo Bakery", font=font(False, 800, 21), fill=INK)
    y += 48
    # checkout-step 1: items
    d.ellipse([PX, y, PX + 40, y + 40], fill=INK)
    f = font(False, 800, 21)
    d.text((PX + (40 - d.textlength("1", font=f)) / 2, y + 7), "1", font=f, fill=CARD)
    d.text((PX + 54, y + 2), "Items", font=font(True, 800, 30), fill=INK)
    y += 58

    def cart_item(name, unit, qty):
        nonlocal y
        rr(d, [PX, y, W - PX, y + 148], 24, fill=CARD, outline=BORDER, width=2)
        d.text((PX + 24, y + 20), name, font=font(True, 800, 23), fill=INK)
        d.text((PX + 24, y + 52), f"Rs {unit} each", font=font(False, 400, 19), fill=MUTED)
        tf = font(True, 800, 23)
        tot = f"Rs {unit * qty:,}"
        d.text((W - PX - 24 - d.textlength(tot, font=tf), y + 20), tot, font=tf, fill=INK)
        # qty-stepper
        sx, sy, sw, sh = PX + 24, y + 88, 190, 52
        rr(d, [sx, sy, sx + sw, sy + sh], 26, outline=BORDER_STRONG, width=2)
        d.text((sx + 22, sy + 8), "\u2212", font=font(False, 700, 26), fill=INK)
        q = str(qty)
        fq = font(False, 800, 23)
        d.text((sx + (sw - d.textlength(q, font=fq)) / 2, sy + 10), q, font=fq, fill=INK)
        d.text((sx + sw - 40, sy + 8), "+", font=font(False, 700, 26), fill=INK)
        d.text((sx + sw + 20, sy + 14), "Remove", font=font(False, 600, 18), fill=MUTED)
        return y + 148 + 18

    y = cart_item("Butter croissant", 450, 2)
    y = cart_item("Sourdough loaf", 650, 1)
    # cart-summary
    rr(d, [PX, y, W - PX, y + 196], 24, fill=CARD, outline=BORDER, width=2)
    sy = y + 24
    for label, val, bold in [("Item subtotal", "Rs 1,550", False),
                             ("Delivery fee", "Rs 150", False)]:
        d.text((PX + 24, sy), label, font=font(False, 400, 20), fill=MUTED)
        f2 = font(True, 800 if bold else 600, 20)
        d.text((W - PX - 24 - d.textlength(val, font=f2), sy), val, font=f2, fill=INK)
        sy += 40
    line(d, (PX + 24, sy + 2), (W - PX - 24, sy + 2), BORDER, 2)
    sy += 20
    d.text((PX + 24, sy), "Total", font=font(True, 800, 24), fill=INK)
    f3 = font(True, 800, 24)
    d.text((W - PX - 24 - d.textlength("Rs 1,700", font=f3), sy), "Rs 1,700", font=f3, fill=INK)
    y += 196 + 26
    # btn-primary (slate): Place order
    rr(d, [PX, y, W - PX, y + 76], 18, fill=INK)
    t = "Place order"
    f4 = font(False, 700, 24)
    d.text(((W - d.textlength(t, font=f4)) / 2, y + 21), t, font=f4, fill=CARD)
    return img

def render_book():
    img = Image.new("RGB", (W, H), PORCELAIN)
    d = ImageDraw.Draw(img)
    status_bar(d)
    y = 84
    i_back(d, PX + 12, y + 14, 28, INK)
    d.text((PX + 34, y), "Back", font=font(False, 700, 22), fill=INK)
    y += 52
    # booking-head (BookService.tsx)
    tracked(d, (PX, y), "SALON", font(False, 800, 17), MUTED, ls=3)
    y += 30
    tracked(d, (PX, y), "Demo Salon", font(True, 800, 46), INK, ls=-1)
    y += 60
    d.text((PX, y), "Gulberg, Lahore \u00b7 ", font=font(False, 400, 20), fill=MUTED)
    w0 = d.textlength("Gulberg, Lahore \u00b7 ", font=font(False, 400, 20))
    d.text((PX + w0, y), "\u2713 Verified", font=font(False, 700, 20), fill=SUCCESS)
    w1 = d.textlength("\u2713 Verified", font=font(False, 700, 20))
    d.text((PX + w0 + w1, y), " \u00b7 ", font=font(False, 400, 20), fill=MUTED)
    w2 = d.textlength(" \u00b7 ", font=font(False, 400, 20))
    d.text((PX + w0 + w1 + w2, y), "Open now", font=font(False, 700, 20), fill=SUCCESS)
    y += 48
    # book-steps
    steps = ["Service", "Date & time", "Details"]
    sx = PX
    for i, s in enumerate(steps):
        if i == 0:
            d.ellipse([sx, y, sx + 36, y + 36], fill=INK)
            i_check(d, sx + 18, y + 18, 26, CARD, w=4)
        elif i == 1:
            d.ellipse([sx, y, sx + 36, y + 36], outline=EMBER, width=4)
            f = font(False, 800, 19)
            d.text((sx + (36 - d.textlength("2", font=f)) / 2, y + 5), "2", font=f, fill=INK)
        else:
            d.ellipse([sx, y, sx + 36, y + 36], outline=BORDER_STRONG, width=3)
            f = font(False, 800, 19)
            d.text((sx + (36 - d.textlength("3", font=f)) / 2, y + 5), "3", font=f, fill=MUTED)
        d.text((sx + 48, y + 5), s, font=font(False, 700 if i == 1 else 600, 20),
               fill=INK if i <= 1 else MUTED)
        sx += 48 + d.textlength(s, font=font(False, 700, 20)) + 26
        if i < 2:
            line(d, (sx, y + 18), (sx + 34, y + 18), BORDER_STRONG, 3)
            sx += 48
    y += 66
    # Which service?
    d.text((PX, y), "Which service?", font=font(True, 800, 30), fill=INK)
    y += 52

    def svc(name, desc, price, dur, selected):
        nonlocal y
        rr(d, [PX, y, W - PX, y + 128], 22, fill=CARD, outline=EMBER if selected else BORDER,
           width=3 if selected else 2)
        d.text((PX + 24, y + 18), name, font=font(True, 800, 22), fill=INK)
        d.text((PX + 24, y + 50), desc, font=font(False, 400, 18), fill=MUTED)
        d.text((PX + 24, y + 78), dur, font=font(False, 600, 18), fill=MUTED)
        f2 = font(True, 800, 21)
        d.text((W - PX - 24 - d.textlength(price, font=f2) - 52, y + 18), price, font=f2, fill=INK)
        cx, cy = W - PX - 50, y + 64
        d.ellipse([cx - 17, cy - 17, cx + 17, cy + 17], outline=EMBER if selected else BORDER_STRONG,
                  width=4 if selected else 3)
        if selected:
            d.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=EMBER)
        return y + 128 + 16

    y = svc("Haircut & styling", "Cut, wash and finish", "Rs 1,500", "45 min", True)
    y = svc("Beard trim", "Shape and line-up", "Rs 600", "20 min", False)
    d.text((PX, y), "Pick a date", font=font(True, 800, 30), fill=INK)
    y += 52
    dates = [("Fri", "3", "Oct"), ("Sat", "4", "Oct"), ("Sun", "5", "Oct"),
             ("Mon", "6", "Oct"), ("Tue", "7", "Oct")]
    x = PX
    for i, (dw, dn, dm) in enumerate(dates):
        sel = i == 1
        rr(d, [x, y, x + 92, y + 108], 20, fill=INK if sel else CARD,
           outline=None if sel else BORDER, width=2)
        c = CARD if sel else MUTED
        f2 = font(False, 700, 16)
        d.text((x + (92 - d.textlength(dw, font=f2)) / 2, y + 10), dw, font=f2, fill=c)
        f3 = font(True, 800, 30)
        d.text((x + (92 - d.textlength(dn, font=f3)) / 2, y + 32), dn, font=f3, fill=c)
        f4 = font(False, 600, 15)
        d.text((x + (92 - d.textlength(dm, font=f4)) / 2, y + 70), dm, font=f4, fill=c)
        x += 106
    y += 134
    d.text((PX, y), "Pick a time", font=font(True, 800, 30), fill=INK)
    y += 52
    x = PX
    for i, t in enumerate(["10:00 AM", "11:30 AM", "2:00 PM"]):
        sel = i == 0
        f5 = font(False, 700, 19)
        w = d.textlength(t, font=f5) + 44
        rr(d, [x, y, x + w, y + 54], 27, fill=INK if sel else CARD,
           outline=None if sel else BORDER, width=2)
        d.text((x + 22, y + 13), t, font=f5, fill=CARD if sel else INK2)
        x += w + 12
    y += 84
    rr(d, [PX, y, W - PX, y + 76], 18, fill=INK)
    t = "Continue"
    f6 = font(False, 700, 24)
    d.text(((W - d.textlength(t, font=f6)) / 2, y + 21), t, font=f6, fill=CARD)
    return img

def render_orders():
    img = Image.new("RGB", (W, H), PORCELAIN)
    d = ImageDraw.Draw(img)
    status_bar(d)
    y = app_header(d)
    tracked(d, (PX, y), "My orders", font(True, 800, 44), INK, ls=-1)
    y += 66
    # seg-tabs: Active / All (Orders.tsx)
    rr(d, [PX, y, W - PX, y + 58], 20, fill=PORCELAIN, outline=BORDER, width=2)
    rr(d, [PX + 5, y + 5, PX + 5 + 250, y + 53], 15, fill=CARD, outline=BORDER, width=2)
    d.text((PX + 34, y + 14), "Active", font=font(False, 800, 20), fill=INK)
    f = font(False, 800, 17)
    rr(d, [PX + 118, y + 15, PX + 118 + 40, y + 43], 14, fill=INK)
    d.text((PX + 118 + (40 - d.textlength("2", font=f)) / 2, y + 18), "2", font=f, fill=CARD)
    d.text((PX + 290, y + 14), "All", font=font(False, 700, 20), fill=MUTED)
    y += 84
    y = order_card(d, y, "Demo Bakery", "#A1B2C3", "3 items", "Rs 1,700",
                   "Preparing", PREP_BG, PREP_FG, done=2)
    y = order_card(d, y, "Demo Caf\u00e9", "#D4E5F6", "2 items", "Rs 850",
                   "Pending", PEND_BG, PEND_FG, done=0)
    bottom_nav(d, active=2)
    return img

def render_bookings():
    img = Image.new("RGB", (W, H), PORCELAIN)
    d = ImageDraw.Draw(img)
    status_bar(d)
    y = app_header(d)
    tracked(d, (PX, y), "My bookings", font(True, 800, 44), INK, ls=-1)
    y += 66
    y = section_header(d, y, "Upcoming", "2 bookings", action_color=MUTED)
    y = booking_card(d, y, "3", "OCT", "Haircut & styling", "Demo Salon",
                     "10:00 AM - 11:00 AM", "Rs 1,500", "Confirmed", CONF_BG, SUCCESS)
    y = booking_card(d, y, "5", "OCT", "Deep tissue massage", "Demo Spa",
                     "4:30 PM - 5:30 PM", "Rs 3,200", "Pending", PEND_BG, PEND_FG)
    y += 10
    y = section_header(d, y, "Past", action=None)
    y = booking_card(d, y, "21", "SEP", "Beard trim", "Demo Barbershop",
                     "6:00 PM - 6:20 PM", "Rs 600", "Completed", BRAND_SOFT, INK2)
    bottom_nav(d, active=3)
    return img

def wide_crop(img, y_off):
    s = img.resize((800, int(H * 800 / W)), Image.LANCZOS)
    return s.crop((0, y_off, 800, y_off + 600))

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    home = render_home();      home.save(f"{OUT}/hero-home.png")
    explore = render_explore(); explore.save(f"{OUT}/cta-explore.png")
    cart = render_cart()
    book = render_book()
    orders = render_orders()
    bookings = render_bookings()
    wide_crop(explore, 60).save(f"{OUT}/product-discover.png")
    wide_crop(cart, 560).save(f"{OUT}/product-order.png")
    wide_crop(book, 440).save(f"{OUT}/product-book.png")
    wide_crop(orders, 60).save(f"{OUT}/experience-order.png")
    wide_crop(bookings, 60).save(f"{OUT}/experience-book.png")
    print("saved 7 screens to", OUT)
