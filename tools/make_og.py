#!/usr/bin/env python3
"""Картинка для ссылки (og:image) и иконки сайта. Запускать после смены названия/подписи:
   python3 tools/make_og.py  →  docs/og.png (1200×630), docs/favicon.svg, docs/apple-touch-icon.png
Шрифты системные (Georgia/Arial) — в них есть казахские буквы; Fraunces с сайта в PIL не тянем."""
import pathlib
from PIL import Image, ImageDraw, ImageFont

root = pathlib.Path(__file__).resolve().parent.parent
docs = root / 'docs'; docs.mkdir(exist_ok=True)
BG, INK, MUTED, ACCENT, GOLD, BORDER = '#faf8f3', '#1e2a30', '#5c6b70', '#0e6e86', '#8c6118', '#e6e0d2'
F = '/System/Library/Fonts/Supplemental/'
def font(name, size): return ImageFont.truetype(F + name, size)

def og():
    im = Image.new('RGB', (1200, 630), BG); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 1199, 629], outline=BORDER, width=2)
    d.rectangle([0, 0, 14, 629], fill=ACCENT)
    d.text((80, 84), 'ҚАЗТЕСТ  ·  QAZRESMITEST', font=font('Arial Bold.ttf', 26), fill=ACCENT)
    d.text((80, 150), 'Qazaq Trainer', font=font('Georgia Bold.ttf', 96), fill=INK)
    d.line([(80, 292), (300, 292)], fill=GOLD, width=4)
    sub = ['Мок-тесты по уровням A1–C2: аудирование, чтение,', 'письмо и говорение с таймером, как на экзамене']
    y = 330
    for line in sub:
        d.text((80, y), line, font=font('Arial.ttf', 38), fill=MUTED); y += 52
    x = 80
    for chip in ['22 варианта', 'с озвучкой', 'бесплатно', 'без регистрации']:
        f = font('Arial Bold.ttf', 24); w = d.textlength(chip, font=f)
        d.rounded_rectangle([x, 500, x + w + 44, 552], 26, fill='#e4f1f2')
        d.text((x + 22, 513), chip, font=f, fill=ACCENT); x += w + 60
    im.save(docs / 'og.png', optimize=True)
    return (docs / 'og.png').stat().st_size

def icons():
    (docs / 'favicon.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="14" fill="#0e6e86"/>'
        '<text x="32" y="45" font-family="Georgia,serif" font-size="40" font-weight="bold"'
        ' fill="#ffffff" text-anchor="middle">Q</text></svg>', encoding='utf-8')
    im = Image.new('RGB', (180, 180), ACCENT); d = ImageDraw.Draw(im)
    f = font('Georgia Bold.ttf', 112)
    b = d.textbbox((0, 0), 'Q', font=f)
    d.text(((180 - (b[2] - b[0])) / 2 - b[0], (180 - (b[3] - b[1])) / 2 - b[1]), 'Q', font=f, fill='#ffffff')
    im.save(docs / 'apple-touch-icon.png', optimize=True)

n = og(); icons()
print('docs/og.png %d КБ, docs/favicon.svg, docs/apple-touch-icon.png' % (n // 1024))
