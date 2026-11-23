#!/usr/bin/env python3
"""Сторис-анонс «новый ролик» для Instagram и TikTok (15.11.2026): 1080×1920, ~6,5 с, mp4.

Кадр: фон в цветах сайта, уменьшенный ролик в карточке «как репост» (играет без звука), поверх него наш кубиковый
герой из соцсети/_3d/*.mov (прозрачный клип, сцена по типу ролика) и три надписи «новый ролик» на русском,
казахском и английском. Надписи берутся из пулов ниже, по номеру ролика, так что соседние сторис не повторяются.

  python3 tools/social/story_ann.py 45            один ролик из соцсети/_publish/queue.json (файл v/045.mp4)
  python3 tools/social/story_ann.py 45-54         диапазон
  python3 tools/social/story_ann.py 45 --look=2   принудительно вид 0..2 (иначе по номеру)
  python3 tools/social/story_ann.py 45 --png      только первый кадр-проверка (быстро)

Выход: соцсети/сторис/NN.mp4 (+ NN.png, NN.txt с выбранными строками) и копия соцсети/_publish/v/story-N.mp4: её воркер
выкладывает в Instagram и присылает владельцу для TikTok (stories.js, 23.11.2026; после сборки нужен деплой воркера).
Один файл на обе площадки, поэтому в шапке карточки нет слова «Reels». Казахские строки пула проверены kk-master
(слова в словарях), пары слов корпус не подтверждает — весь казахский идёт носителю (соцсети/сторис/казахский-на-проверку.md).
Без длинного тире. Ничего никуда не публикует."""
import json, pathlib, subprocess, sys, tempfile, re
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]                       # qazaq-trainer/
SOC = ROOT.parent / 'соцсети'
OUT = SOC / 'сторис'
W, H, DUR = 1080, 1920, 6.5
NAVY, SUN, ONSUN, PALE, WHITE = (0x34, 0x49, 0x7a), (0xf0, 0xd4, 0x8a), (0x23, 0x2d, 0x45), (0xe4, 0xe8, 0xf0), (255, 255, 255)

RU = ['Новый ролик', 'Вышел новый ролик', 'Смотрите, что мы выложили', 'Мы выложили новый ролик', 'Новый ролик уже в ленте',
      'Свежий ролик, загляните', 'Ну что, новый ролик!', 'Новый ролик. Посмотрите', 'Выложили новое, зацените', 'Новый ролик ждёт вас']
KK = ['Жаңа ролик', 'Жаңа ролик шықты', 'Жаңа ролик дайын', 'Жаңа ролик келді', 'Міне, жаңа ролик', 'Қараңдаршы, жаңа ролик',
      'Жаңасы шықты', 'Жаңа ролик бізде', 'Қараңыз: жаңа ролик', 'Жаңа бейнеролик']
EN = ['New video', 'New video is out', 'We just posted a new one', 'New video, go watch', 'Fresh one just dropped',
      'Check out our new video', 'Our new video is up', "New one's up, take a look", 'Just posted, new video', 'New video is live']

# сцена героя по типу ролика; _w (героиня) берём через раз, если такой клип отрендерен
SCENES = {'Язык': ['qt_listen', 'qt_search', 'qt_read', 'qt_type'], 'Проверь себя': ['qt_puzzled', 'qt_win', 'qt_time', 'qt_result'],
          'Разбор': ['qt_read', 'qt_result', 'qt_search', 'qt_time'], 'История': ['qt_type', 'qt_rush', 'qt_puzzled', 'qt_win']}

def font(name, size): return ImageFont.truetype(str(HERE / 'fonts' / name), size)

def pick(n):
    """Строки для ролика n: три разных шага по пулам из 10 (шаги 3, 7, 9 взаимно просты с 10, соседи не совпадают)."""
    return RU[(n * 3) % 10], KK[(n * 7 + 3) % 10], EN[(n * 9 + 5) % 10]

def scene_for(n, slot):
    names = SCENES.get(slot, SCENES['Язык'])
    s = names[(n // 2 + n) % len(names)]
    if n % 2 and (SOC / '_3d' / (s + '_w.mov')).exists(): s += '_w'
    return s

def pattern(im, mark, size, alpha, gap):
    m = mark.resize((size, size), Image.LANCZOS); m.putalpha(m.getchannel('A').point(lambda v: int(v * alpha)))
    step, row = size + gap, 0
    for y in range(-size // 2, H, step):
        for x in range(-(step // 2 if row % 2 else 0), W, step): im.alpha_composite(m, (x, y)) if x >= 0 and y >= 0 and x + size <= W and y + size <= H else None
        row += 1

SCHEMES = [   # фон, орнамент, пилюли (заливка, текст) для RU / KK / EN, рамка карточки
    dict(bg=NAVY, mark='mark-sun', pills=[(SUN, ONSUN), (WHITE, NAVY), (None, WHITE)], frame=WHITE),
    dict(bg=SUN, mark='mark-navy', pills=[(NAVY, WHITE), (WHITE, NAVY), (None, ONSUN)], frame=WHITE),
    dict(bg=(0xf2, 0xf3, 0xf6), mark='mark-navy', pills=[(NAVY, WHITE), (SUN, ONSUN), (None, NAVY)], frame=WHITE),
]
# вид: размер вставки ролика, положение центра, угол, герой (ширина, центр), пилюли (центр x, y, угол, размер шрифта)
LOOKS = [
    dict(cw=600, c=(500, 1000), ang=-4, hero=(640, (790, 1380)), pills=[(540, 330, -2, 104), (330, 1590, 2, 70), (760, 1730, -2, 62)]),
    dict(cw=540, c=(380, 930), ang=3, hero=(700, (760, 1290)), pills=[(540, 300, 2, 100), (700, 1640, -2, 70), (400, 1760, 2, 62)]),
    dict(cw=560, c=(600, 960), ang=-2, hero=(620, (300, 1330)), pills=[(540, 330, -1, 100), (700, 1650, 2, 70), (440, 1770, -2, 62)]),
]

def pill(text, kind, sch, size):
    fill, ink = sch['pills'][kind]
    f = font('Geologica-800.ttf' if kind < 2 else 'GolosText-600.ttf', size)
    while f.getlength(text) > W - 200 and size > 40: size -= 4; f = font('Geologica-800.ttf' if kind < 2 else 'GolosText-600.ttf', size)
    tw, th = int(f.getlength(text)), size
    px, py = 46, 26
    im = Image.new('RGBA', (tw + 2 * px + 60, int(th * 1.35) + 2 * py + 60), (0, 0, 0, 0))
    d = ImageDraw.Draw(im); box = (30, 30, im.width - 30, im.height - 30)
    if fill:
        sh = Image.new('RGBA', im.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((box[0], box[1] + 10, box[2], box[3] + 10), 40, fill=(0, 0, 0, 70))
        im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)))
        d.rounded_rectangle(box, 40, fill=fill + (255,))
    d.text((im.width / 2, im.height / 2 - 2), text, font=f, fill=ink, anchor='mm')
    return im

def card_frame(cw, sch):
    """Рамка «репост»: белая карточка с шапкой, окно под ролик прозрачное. Возвращает (рамка, смещение окна, высота окна)."""
    ch = round(cw * 16 / 9)
    head, pad = 92, 18
    im = Image.new('RGBA', (cw + 2 * pad, ch + head + pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, im.width - 1, im.height - 1), 34, fill=sch['frame'] + (255,))
    d.rounded_rectangle((pad, head, pad + cw, head + ch), 22, fill=(0, 0, 0, 0))
    hole = Image.new('L', im.size, 0); ImageDraw.Draw(hole).rounded_rectangle((pad, head, pad + cw, head + ch), 22, fill=255)
    a = im.getchannel('A'); a.paste(0, mask=hole); im.putalpha(a)
    mk = Image.open(HERE / 'brand' / 'mark-navy.png').convert('RGBA').resize((56, 56), Image.LANCZOS)
    d.ellipse((pad, 18, pad + 60, 78), fill=SUN + (255,)); im.alpha_composite(mk, (pad + 2, 20))
    d.text((pad + 76, 48), 'qazaq.trainer', font=font('GolosText-600.ttf', 38), fill=ONSUN, anchor='lm')
    # слово «Reels» справа в шапке убрано 23.11.2026: тот же файл идёт и в TikTok
    return im, (pad, head), ch

def build(n, look=None, png_only=False):
    q = {x['n']: x for x in json.load(open(SOC / '_publish' / 'queue.json'))}[n]
    src = SOC / '_publish' / q['file']
    li = n % 3 if look is None else look
    sch, lk = SCHEMES[(n + n // 3) % 3], LOOKS[li]
    ru, kk, en = pick(n)
    OUT.mkdir(exist_ok=True)
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='story'))
    # фон
    bg = Image.new('RGBA', (W, H), sch['bg'] + (255,))
    pattern(bg, Image.open(HERE / 'brand' / (sch['mark'] + '.png')).convert('RGBA'), 150, 0.10, 90)
    bg.save(tmp / 'bg.png')
    # карточка: рамка + окно под ролик; поворачиваем целиком в ffmpeg
    frame, (ox, oy), ch = card_frame(lk['cw'], sch)
    frame.save(tmp / 'frame.png')
    mask = Image.new('L', (lk['cw'], ch), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, lk['cw'] - 1, ch - 1), 22, fill=255); mask.save(tmp / 'mask.png')
    # надписи
    items = []
    for i, (text, (cx, cy, ang, size)) in enumerate(zip((ru, kk, en), lk['pills'])):
        p = pill(text, i, sch, size).rotate(ang, resample=Image.BICUBIC, expand=True)
        p.save(tmp / ('t%d.png' % i)); items.append((p.size, min(max(cx, p.width // 2 + 20), W - p.width // 2 - 20), cy))
    scene = scene_for(n, q['slot'])
    clip = SOC / '_3d' / (scene + '.mov')
    hw, (hx, hy) = lk['hero']
    # ffmpeg
    fw, fh = frame.size
    fg = [
        '[0:v]format=rgba[bg]',
        '[1:v]trim=duration=%.2f,setpts=PTS-STARTPTS,fps=30,scale=%d:%d,format=rgba[rv]' % (DUR, lk['cw'], ch),
        '[2:v]format=gray[mk]', '[rv][mk]alphamerge[rm]',
        'color=c=black@0:s=%dx%d:r=30,format=rgba[cc]' % (fw, fh),
        '[cc][rm]overlay=%d:%d:format=auto[c1]' % (ox, oy),
        '[3:v]format=rgba[fr]', '[c1][fr]overlay=0:0:format=auto[c2]',
        '[c2]rotate=%f*PI/180:ow=rotw(%f*PI/180):oh=roth(%f*PI/180):c=none[card]' % (lk['ang'], lk['ang'], lk['ang']),
        # въезд карточки снизу за 0,5 с
        "[bg][card]overlay=x=%d-w/2:y='%d-h/2+pow(1-min(1,t/0.5),2)*1500':format=auto[v1]" % (lk['c'][0], lk['c'][1]),
        '[4:v]format=rgba,scale=%d:-1:flags=lanczos[hero]' % hw,
        # герой выскакивает на 0,5 с и чуть пружинит
        "[v1][hero]overlay=x=%d-w/2:y='%d-h/2+pow(1-min(1,max(0,t-0.5)/0.45),2)*700-sin(max(0,t-0.95)*5)*18*exp(-max(0,t-0.95)*2)':format=auto[v2]" % (hx, hy),
    ]
    last, t0 = 'v2', [1.1, 1.6, 2.0]
    for i, ((pw, ph), cx, cy) in enumerate(items):
        fg.append("[%d:v]format=rgba[p%d]" % (5 + i, i))
        fg.append("[%s][p%d]overlay=x=%d-w/2:y='%d-h/2+pow(1-min(1,max(0,t-%.2f)/0.35),2)*140':enable='gte(t,%.2f)':format=auto[v%d]" % (last, i, cx, cy, t0[i], t0[i], 3 + i))
        last = 'v%d' % (3 + i)
    fg.append('[%s]format=yuv420p[out]' % last)
    out = OUT / ('%02d.mp4' % n)
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-t', '%.2f' % DUR, '-i', str(tmp / 'bg.png'), '-i', str(src), '-loop', '1', '-t', '%.2f' % DUR, '-i', str(tmp / 'mask.png'),
           '-loop', '1', '-t', '%.2f' % DUR, '-i', str(tmp / 'frame.png'), '-stream_loop', '-1', '-t', '%.2f' % DUR, '-i', str(clip)]
    for i in range(3): cmd += ['-loop', '1', '-t', '%.2f' % DUR, '-i', str(tmp / ('t%d.png' % i))]
    cmd += ['-i', str(HERE / 'brand' / 'chime.wav')]
    fg.append('[8:a]volume=0.5,adelay=1000|1000,apad=whole_dur=%.2f,aresample=44100,aformat=channel_layouts=stereo[a]' % DUR)
    (tmp / 'fg.txt').write_text(';\n'.join(fg))
    cmd += ['-/filter_complex', str(tmp / 'fg.txt'), '-map', '[out]', '-map', '[a]', '-t', '%.2f' % DUR, '-r', '30',
            '-threads', '2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(out)]
    subprocess.run(cmd, check=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '3.2', '-i', str(out), '-frames:v', '1', str(OUT / ('%02d.png' % n))], check=True)
    (OUT / ('%02d.txt' % n)).write_text('ролик №%d (%s), вид %d, сцена %s\nRU: %s\nKK: %s\nEN: %s\n' % (n, q['id'], li, scene, ru, kk, en))
    pub = SOC / '_publish' / 'v' / ('story-%d.mp4' % n)
    pub.write_bytes(out.read_bytes())
    print('№%d  %s | %s | %s  [%s, вид %d]' % (n, ru, kk, en, scene, li))
    return out

def main():
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    opt = dict(x[2:].split('=') if '=' in x else (x[2:], '1') for x in sys.argv[1:] if x.startswith('--'))
    if not a: sys.exit(__doc__)
    lo, _, hi = a[0].partition('-')
    for n in range(int(lo), int(hi or lo) + 1): build(n, int(opt['look']) if 'look' in opt else None)

if __name__ == '__main__': main()
