#!/usr/bin/env python3
"""Лента кадров человечка для шкалы прокрутки в тесте (12.11.2026) → src/design/scenes/walker.webp.
Рендерит 12 кадров в Blender (tools/social/blender/walker.py), обрезает по общему контуру и склеивает в одну строку.
Кадры: 0-7 шаг, 8 стойка, 9-11 рука вверх. Размер кадра печатается в конце: его соотношение сторон стоит в d1.css (.dz-walker).
Нужны Blender, cwebp и Pillow."""
import pathlib, subprocess, tempfile
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
HEIGHT = 132   # высота кадра в ленте: на экране человечек 44 px, запас на плотные экраны

with tempfile.TemporaryDirectory() as tmp:
    tmp = pathlib.Path(tmp)
    subprocess.run([BLENDER, '-b', '--factory-startup', '--python', str(ROOT / 'tools' / 'social' / 'blender' / 'walker.py'), '--', '--draft', '--out', str(tmp)],
                   check=True, stdout=subprocess.DEVNULL)
    ims = [Image.open(f).convert('RGBA') for f in sorted((tmp / 'walker').glob('f_*.png'))]
    assert len(ims) == 12, len(ims)
    box = None
    for im in ims:
        b = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    w = round((box[2] - box[0]) * HEIGHT / (box[3] - box[1]))
    strip = Image.new('RGBA', (w * len(ims), HEIGHT), (0, 0, 0, 0))
    for k, im in enumerate(ims): strip.paste(im.crop(box).resize((w, HEIGHT), Image.LANCZOS), (k * w, 0))
    strip.save(tmp / 'strip.png')
    out = ROOT / 'src' / 'design' / 'scenes' / 'walker.webp'
    subprocess.run(['cwebp', '-quiet', '-q', '82', '-alpha_q', '90', str(tmp / 'strip.png'), '-o', str(out)], check=True)
    print('walker.webp: кадр %d x %d, %d кадров, %d КБ' % (w, HEIGHT, len(ims), out.stat().st_size // 1024))
