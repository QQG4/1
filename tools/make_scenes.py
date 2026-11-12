#!/usr/bin/env python3
"""Кубиковые сцены для сайта (12.11.2026): ролики с прозрачным фоном из ../соцсети/_3d/qt_*.mov → анимированный WebP
и неподвижный кадр в src/design/scenes/. Нужны ffmpeg, img2webp и cwebp (brew install ffmpeg webp) и Pillow.
Запуск: python3 tools/make_scenes.py [имя ...]. В конце печатает таблицу размеров для SCENES в src/design/design.js."""
import pathlib, shutil, subprocess, sys, tempfile
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT.parent / 'соцсети' / '_3d'
OUT = ROOT / 'src' / 'design' / 'scenes'
NAMES = ['read', 'time', 'listen', 'search', 'type', 'puzzled', 'win', 'result', 'rush']
WIDTH, FPS, QUALITY = 400, 15, 62

def make(name):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(SRC / ('qt_%s.mov' % name)), '-vf', 'fps=%d,scale=%d:-1:flags=lanczos' % (FPS, WIDTH),
                        '-pix_fmt', 'rgba', str(tmp / '%03d.png')], check=True)
        frames = sorted(tmp.glob('*.png'))
        box = None   # общий прямоугольник непрозрачного по всем кадрам: пустые поля не занимают место на странице
        for f in frames:
            b = Image.open(f).getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
            if b: box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
        box = (max(0, box[0] - 2), max(0, box[1] - 2), box[2] + 2, box[3] + 2)
        for f in frames: Image.open(f).crop(box).save(f)
        OUT.mkdir(parents=True, exist_ok=True)
        subprocess.run(['img2webp', '-loop', '0', '-lossy', '-q', str(QUALITY), '-m', '4', '-d', str(round(1000 / FPS))] + [str(f) for f in frames] +
                       ['-o', str(OUT / (name + '.webp'))], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(['cwebp', '-quiet', '-q', '80', str(frames[len(frames) // 2]), '-o', str(OUT / (name + '-still.webp'))], check=True)
        w, h = box[2] - box[0], box[3] - box[1]
        print("    %s: [%d, %d],   // %d КБ" % (name, w, h, (OUT / (name + '.webp')).stat().st_size // 1024))

if __name__ == '__main__':
    for tool in ('ffmpeg', 'img2webp', 'cwebp'):
        if not shutil.which(tool): sys.exit('нет ' + tool)
    for n in (sys.argv[1:] or NAMES): make(n)
