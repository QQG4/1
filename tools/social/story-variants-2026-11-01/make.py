"""Три варианта картинки результата для сторис (01.11.2026). Пример: Qazaq Resmi Test A2, лексика, 8/10."""
from PIL import Image, ImageDraw, ImageFont
import os
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(here, '..'))
F = lambda n, s: ImageFont.truetype(os.path.join(root, 'fonts', n), s)
NAVY, SUN, ONSUN, BG, SURF = (0x34, 0x49, 0x7a), (0xf0, 0xd4, 0x8a), (0x23, 0x2d, 0x45), (0xf2, 0xf3, 0xf6), (0xfc, 0xfc, 0xfd)
W, H = 1080, 1920
mark_navy = Image.open(os.path.join(root, 'brand', 'mark-navy.png')).convert('RGBA')
mark_sun = Image.open(os.path.join(root, 'brand', 'mark-sun.png')).convert('RGBA')
EXAM, LEVEL, SECTION, SCORE, TOTAL = 'Qazaq Resmi Test', 'A2', 'Лексика и орфография', 8, 10

def tint(mark, size, alpha):
    m = mark.resize((size, size), Image.LANCZOS); a = m.getchannel('A').point(lambda v: int(v * alpha)); m.putalpha(a); return m
def pattern(im, mark, size, alpha, gap):
    m = tint(mark, size, alpha); step = size + gap; row = 0
    for y in range(-size // 2, H, step):
        off = (step // 2) if row % 2 else 0
        for x in range(-off, W, step): im.alpha_composite(m, (x, y)) if 0 <= x < W - 1 and 0 <= y < H - 1 else im.alpha_composite(m.crop((max(0, -x), max(0, -y), min(size, W - x), min(size, H - y))), (max(x, 0), max(y, 0))) if x < W and y < H and x + size > 0 and y + size > 0 else None
        row += 1
def center(d, y, text, font, fill):
    w = d.textlength(text, font=font); d.text(((W - w) / 2, y), text, font=font, fill=fill)
def rrect(d, box, r, fill): d.rounded_rectangle(box, r, fill=fill)
def footer(d, y, fg, soft):
    center(d, y, 'qazaqtrainer.com', F('Geologica-800.ttf', 64), fg)
    center(d, y + 90, 'Telegram  ·  TikTok  ·  Instagram: @qazaq.trainer', F('GolosText-600.ttf', 38), soft)

def a():   # навигатор: синий фон с орнаментом, жёлтый счёт
    im = Image.new('RGBA', (W, H), NAVY + (255,)); pattern(im, mark_sun, 150, 0.10, 90)
    d = ImageDraw.Draw(im)
    big = tint(mark_sun, 520, 0.9); im.alpha_composite(big, ((W - 520) // 2, 150))
    center(d, 760, EXAM + ' · ' + LEVEL, F('Geologica-800.ttf', 62), (255, 255, 255))
    center(d, 850, SECTION, F('GolosText-600.ttf', 52), (228, 232, 240))
    center(d, 950, '%d' % SCORE, F('Geologica-800.ttf', 520), SUN)
    center(d, 1480, 'из %d' % TOTAL, F('Geologica-700.ttf', 80), (255, 255, 255))
    rrect(d, (140, 1620, W - 140, 1650), 15, (255, 255, 255, 50)); rrect(d, (140, 1620, 140 + (W - 280) * SCORE // TOTAL, 1650), 15, SUN)
    footer(d, 1720, (255, 255, 255), (200, 208, 224)); return im
def b():   # светлый: карточка на сером, синий счёт, жёлтая полоса
    im = Image.new('RGBA', (W, H), BG + (255,)); pattern(im, mark_navy, 150, 0.06, 90)
    d = ImageDraw.Draw(im)
    rrect(d, (70, 260, W - 70, 1560), 8, SURF); d.rectangle((70, 260, W - 70, 290), fill=SUN)
    im.alpha_composite(tint(mark_navy, 220, 1), ((W - 220) // 2, 370))
    center(d, 640, EXAM + ' · ' + LEVEL, F('Geologica-800.ttf', 58), NAVY)
    center(d, 725, SECTION, F('GolosText-600.ttf', 48), (90, 100, 125))
    center(d, 800, '%d/%d' % (SCORE, TOTAL), F('Geologica-800.ttf', 360), NAVY)
    rrect(d, (170, 1290, W - 170, 1320), 15, (225, 228, 236)); rrect(d, (170, 1290, 170 + (W - 340) * SCORE // TOTAL, 1320), 15, NAVY)
    center(d, 1390, 'Попробуй свой уровень бесплатно', F('GolosText-600.ttf', 46), (90, 100, 125))
    d.rectangle((0, 1690, W, 1920), fill=NAVY); footer(d, 1730, (255, 255, 255), (200, 208, 224)); return im
def c():   # жёлтый: крупный синий счёт на жёлтом
    im = Image.new('RGBA', (W, H), SUN + (255,)); pattern(im, mark_navy, 150, 0.10, 90)
    d = ImageDraw.Draw(im)
    center(d, 250, EXAM, F('Geologica-800.ttf', 74), ONSUN); center(d, 350, 'уровень ' + LEVEL + ' · ' + SECTION, F('GolosText-600.ttf', 46), ONSUN)
    center(d, 560, '%d/%d' % (SCORE, TOTAL), F('Geologica-800.ttf', 440), NAVY)
    rrect(d, (140, 1130, W - 140, 1170), 20, (255, 255, 255, 140)); rrect(d, (140, 1130, 140 + (W - 280) * SCORE // TOTAL, 1170), 20, NAVY)
    rrect(d, (140, 1330, W - 140, 1560), 12, NAVY)
    center(d, 1375, 'Проверь свой уровень', F('Geologica-800.ttf', 64), (255, 255, 255)); center(d, 1470, 'Бесплатно. Без регистрации.', F('GolosText-600.ttf', 46), SUN)
    footer(d, 1690, ONSUN, (60, 70, 100)); return im
for name, fn in (('вариант-1-синий', a), ('вариант-2-светлый', b), ('вариант-3-жёлтый', c)):
    fn().convert('RGB').save(os.path.join(here, name + '.png')); print(name)
