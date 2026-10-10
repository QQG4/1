#!/usr/bin/env python3
"""Короткий вертикальный ролик (1080×1920) из вопроса мок-теста — для TikTok, Instagram Reels и YouTube Shorts.

Запуск:  python3 tools/social/make_short.py <testId> <qid> [--out=../соцсети/проба] [--voice=kk-KZ-DauletNeural]
Пример:  python3 tools/social/make_short.py qrt-c1-04 x1

Ролик: крючок (2–3 с) → вопрос и варианты, голос читает вопрос → отсчёт 5 с → ответ с пояснением, голос читает
правильный вариант и пояснение → концовка со ссылкой. Рядом кладётся текст поста с хэштегами и ссылками с метками.
Тексты на экране и в озвучке берутся из данных теста (вопрос, варианты, explain / explain_kk); своего казахского
текста здесь только крючок и концовка (HOOKS, OUTRO) — их стоит показать носителю.
Нужны: ffmpeg, PIL, ключ Azure в ~/.config/qazaq-trainer/azure.env (тот же, что у tools/tts_azure.py).
Музыку не добавляем: её берут из библиотеки площадки при загрузке, так нет вопросов с авторскими правами."""
import json, os, pathlib, random, subprocess, sys, tempfile, urllib.request, http.client, time
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
W, H = 1080, 1920
TEAL, TEAL_DARK, WHITE, INK, MUTED = '#0e6e86', '#0a5568', '#ffffff', '#1e2a30', '#5c6b70'
GOOD, GOOD_SOFT, GOLD, FADE = '#2f7d4f', '#e4f1e8', '#e9c46a', '#cfdfe3'
F = '/System/Library/Fonts/Supplemental/'
def font(name, size): return ImageFont.truetype(F + name, size)

EXAM = {'kaztest': 'ҚАЗТЕСТ', 'qrt': 'QazResmiTest'}
SECTION = {'lexis': ('Лексика', 'Лексика'), 'reading': ('Оқылым', 'Чтение'), 'listening': ('Тыңдалым', 'Аудирование')}
# Крючок на первые секунды: честное обещание, без выдуманной статистики. Ключ — признак вопроса.
HOOKS = {
    'phrase': ('Сөзбе-сөз аударсаңыз, қателесесіз', 'Переведёте дословно, ошибётесь'),
    'default': ('Жауабын білесіз бе?', 'Знаете ответ?'),
}
# Без чисел и слова «бесплатно» в концовке: решение владельца 10.10.2026 («это дешевит»)
OUTRO = ('Басқа тапсырмалар мен толық сынақ тесттер біздің сайтта', 'Больше заданий и полные пробные тесты на нашем сайте')
COUNTDOWN = 4   # секунд на раздумье (решение владельца 10.10.2026)
# Один голос на ролик, голоса чередуются между роликами; Daulet звучит в двух роликах из трёх (решение владельца
# 10.10.2026). Второй голос внутри ролика — только когда по сюжету действительно говорят двое (диалог в аудировании).
AIGUL, DAULET = 'kk-KZ-AigulNeural', 'kk-KZ-DauletNeural'
def voice_for(test_id, qid):
    return AIGUL if sum(map(ord, test_id + qid)) % 3 == 0 else DAULET

def nodash(t):
    """Длинное тире в роликах и подписях не используем (решение владельца 10.10.2026). В данных оно стоит
    между подлежащим и сказуемым («термин — значение», «буквальное прочтение — ловушка»), поэтому меняем на
    двоеточие: запятая в этих местах читается как ошибка."""
    return str(t).replace(' — ', ': ').replace('—', ': ').replace(' :', ':')

# ---------- данные ----------
def load_question(test_id, qid):
    js = ("global.KZ={tests:[]};require('./src/data/tests/%s.js');const t=KZ.tests[0];"
          "for(const s of t.sections)for(const q of (s.questions||[]))if(q.id===%s){"
          "process.stdout.write(JSON.stringify({exam:t.exam,level:t.level,section:s.type,q}));process.exit(0)}"
          "process.exit(1)") % (test_id, json.dumps(qid))
    out = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True)
    if out.returncode: sys.exit('вопрос %s %s не найден' % (test_id, qid))
    return json.loads(out.stdout)

# ---------- озвучка ----------
def azure_env():
    env = {}
    for line in pathlib.Path(os.path.expanduser('~/.config/qazaq-trainer/azure.env')).read_text().splitlines():
        if '=' in line and not line.startswith('#'): k, v = line.split('=', 1); env[k.strip()] = v.strip()
    return env
def tts(text, voice, path):
    env = azure_env()
    ssml = ('<speak version="1.0" xml:lang="kk-KZ"><voice name="%s"><prosody rate="-5%%">%s</prosody></voice></speak>'
            % (voice, text.replace('&', 'және').replace('<', '').replace('>', '')))
    req = urllib.request.Request('https://%s.tts.speech.microsoft.com/cognitiveservices/v1' % env.get('AZURE_SPEECH_REGION', 'westeurope'),
                                 data=ssml.encode('utf-8'), method='POST',
                                 headers={'Ocp-Apim-Subscription-Key': env['AZURE_SPEECH_KEY'], 'Content-Type': 'application/ssml+xml',
                                          'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3', 'User-Agent': 'qazaq-trainer'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r: path.write_bytes(r.read()); return
        except (http.client.IncompleteRead, ConnectionError, TimeoutError):
            if attempt == 3: raise
            time.sleep(5 * (attempt + 1))
def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)], capture_output=True, text=True)
    return float(out.stdout.strip())

# ---------- рисование ----------
def wrap(d, text, f, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=f) <= width: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines
def text_block(d, text, f, x, y, width, fill, gap=1.25, center=False):
    for line in wrap(d, text, f, width):
        lx = x + (width - d.textlength(line, font=f)) / 2 if center else x
        d.text((lx, y), line, font=f, fill=fill); y += int(f.size * gap)
    return y
def base(meta):
    im = Image.new('RGB', (W, H), TEAL); d = ImageDraw.Draw(im)
    d.rectangle([0, int(H * 0.72), W, H], fill=TEAL_DARK)
    kk, ru = SECTION.get(meta['section'], ('', ''))
    badge = '%s · %s · %s' % (EXAM[meta['exam']], meta['level'], kk)
    f = font('Arial Bold.ttf', 40)
    d.rounded_rectangle([80, 170, 80 + d.textlength(badge, font=f) + 56, 240], 35, fill='#2b8ba3', outline='#8cc4d2', width=2)   # RGB-картинка: без прозрачности
    d.text((108, 183), badge, font=f, fill=WHITE)
    d.text((80, 1790), 'qazaqtrainer.com', font=font('Arial Bold.ttf', 38), fill='#d8ecf1')
    return im, d

def frame_hook(meta, hook, path):
    im, d = base(meta)
    y = text_block(d, hook[0], font('Arial Bold.ttf', 92), 80, 640, W - 160, WHITE, center=True)
    d.line([(W / 2 - 90, y + 40), (W / 2 + 90, y + 40)], fill=GOLD, width=8)
    text_block(d, hook[1], font('Arial.ttf', 52), 80, y + 90, W - 160, '#d8ecf1', center=True)
    im.save(path)

def frame_question(meta, q, path, count=None, reveal=False, explain=None):
    im, d = base(meta)
    y = text_block(d, q['text'], font('Arial Bold.ttf', 62), 80, 330, W - 160, WHITE)
    y += 40
    fo = font('Arial Bold.ttf', 50)
    for i, o in enumerate(q['options']):
        lines = wrap(d, o, fo, W - 160 - 150)
        hgt = 60 + len(lines) * 64
        good = reveal and i == q['answer']
        bg = GOOD if good else (FADE if reveal else WHITE)
        d.rounded_rectangle([80, y, W - 80, y + hgt], 28, fill=bg)
        d.ellipse([110, y + hgt / 2 - 36, 182, y + hgt / 2 + 36], fill=WHITE if good else TEAL)
        cx, cy = 146, y + hgt / 2
        if good:   # галочку рисуем линиями: в Arial нет знака ✓
            d.line([(cx - 18, cy + 2), (cx - 5, cy + 16), (cx + 20, cy - 14)], fill=GOOD, width=9, joint='curve')
        else:
            d.text((cx, cy), 'ABCD'[i], font=font('Arial Bold.ttf', 44), fill=WHITE, anchor='mm')
        ty = y + 30
        for line in lines:
            d.text((210, ty), line, font=fo, fill=WHITE if good else (MUTED if reveal else INK)); ty += 64
        y += hgt + 26
    if count is not None:
        cy = max(y + 140, 1350)
        d.ellipse([W / 2 - 110, cy - 110, W / 2 + 110, cy + 110], outline=GOLD, width=12)
        d.text((W / 2, cy), str(count), font=font('Arial Bold.ttf', 130), fill=WHITE, anchor='mm')
    if explain:
        ey = y + 30
        box_bottom = text_block(ImageDraw.Draw(Image.new('RGB', (1, 1))), explain[0], font('Arial.ttf', 44), 0, 0, W - 240, INK) \
            + (text_block(ImageDraw.Draw(Image.new('RGB', (1, 1))), explain[1], font('Arial.ttf', 38), 0, 0, W - 240, INK) if explain[1] else 0) + 90
        d.rounded_rectangle([80, ey, W - 80, ey + box_bottom], 28, fill=GOOD_SOFT)
        ny = text_block(d, explain[0], font('Arial.ttf', 44), 120, ey + 35, W - 240, INK)
        if explain[1]: text_block(d, explain[1], font('Arial.ttf', 38), 120, ny + 15, W - 240, MUTED)
    im.save(path)

def frame_outro(meta, path):
    im, d = base(meta)
    d.ellipse([W / 2 - 120, 520, W / 2 + 120, 760], fill=WHITE)
    d.text((W / 2, 640), 'Q', font=font('Georgia Bold.ttf', 170), fill=TEAL, anchor='mm')
    y = text_block(d, OUTRO[0], font('Arial Bold.ttf', 66), 80, 860, W - 160, WHITE, center=True)
    y = text_block(d, OUTRO[1], font('Arial.ttf', 44), 80, y + 25, W - 160, '#d8ecf1', center=True)
    y = text_block(d, 'qazaqtrainer.com', font('Arial Bold.ttf', 76), 80, y + 60, W - 160, GOLD, center=True)
    text_block(d, 'Күн сайын тапсырма · Задание дня: t.me/qazaqtrainer', font('Arial.ttf', 38), 80, y + 40, W - 160, '#d8ecf1', center=True)
    im.save(path)

# ---------- сборка ----------
def build(test_id, qid, out_dir, voice=None, mute=False):
    meta = load_question(test_id, qid); q = dict(meta['q'])
    # в данных ключ часто стоит первым (на сайте варианты перемешиваются при загрузке) — без перемешивания
    # в роликах верным всегда был бы вариант A. Сид от id вопроса: один и тот же ролик пересобирается одинаково.
    order = list(range(len(q['options']))); random.Random(test_id + '/' + qid).shuffle(order)
    q['options'] = [q['options'][i] for i in order]; q['answer'] = order.index(q['answer'])
    hook = HOOKS['phrase'] if 'фразеологизм' in q['text'].lower() else HOOKS['default']
    out_dir.mkdir(parents=True, exist_ok=True)
    name = '%s-%s' % (test_id, qid)
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='short-'))
    q['text'] = nodash(q['text']); q['options'] = [nodash(o) for o in q['options']]
    correct = q['options'][q['answer']]
    ex_kk, ex_ru = nodash(q.get('explain_kk') or q.get('explain') or ''), (nodash(q['explain']) if q.get('explain_kk') else '')
    v = voice or voice_for(test_id, qid)
    # озвучка: крючок, вопрос, ответ с пояснением (казахский — только из данных теста и крючка)
    if mute:   # --mute: без озвучки (проверить вид или если ключ Azure недоступен) — паузы по длине текста
        for n, sec in (('a_hook', 2.0), ('a_q', 3.0 + len(q['text']) / 40), ('a_ans', 3.0 + len(ex_kk) / 30)):
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '%.2f' % sec, str(tmp / (n + '.mp3'))], check=True)
    else:
        tts(hook[0], v, tmp / 'a_hook.mp3')
        tts(q['text'], v, tmp / 'a_q.mp3')
        tts('Дұрыс жауап: ' + correct + '. ' + ex_kk, v, tmp / 'a_ans.mp3')
    d_hook, d_q, d_ans = duration(tmp / 'a_hook.mp3'), duration(tmp / 'a_q.mp3'), duration(tmp / 'a_ans.mp3')

    seg = []   # (картинка, длительность)
    frame_hook(meta, hook, tmp / 'f_hook.png'); seg.append(('f_hook.png', max(2.2, d_hook + 0.4)))
    frame_question(meta, q, tmp / 'f_q.png'); seg.append(('f_q.png', max(3.0, d_q + 0.6)))
    for c in range(COUNTDOWN, 0, -1):
        frame_question(meta, q, tmp / ('f_c%d.png' % c), count=c); seg.append(('f_c%d.png' % c, 1.0))
    frame_question(meta, q, tmp / 'f_ans.png', reveal=True, explain=(ex_kk, ex_ru)); seg.append(('f_ans.png', max(4.0, d_ans + 1.2)))
    frame_outro(meta, tmp / 'f_out.png'); seg.append(('f_out.png', 3.0))

    t_q = seg[0][1]; t_ans = sum(s for _, s in seg[:-2])
    total = sum(s for _, s in seg)
    mp4 = out_dir / (name + '.mp4')
    # каждая картинка — отдельный вход точной длины, склейка фильтром concat: склейка через список файлов
    # теряла около двух секунд, и картинка заканчивалась раньше звука
    vin = []
    for f, dur in seg: vin += ['-loop', '1', '-framerate', '30', '-t', '%.3f' % dur, '-i', str(tmp / f)]
    n = len(seg); a0 = n   # индексы звуковых входов идут после картинок
    graph = (''.join('[%d:v]' % i for i in range(n)) + 'concat=n=%d:v=1:a=0[v];' % n +
             # громкость — к норме соцсетей (около −14 LUFS)
             '[%d:a]adelay=%d|%d[q];[%d:a]adelay=%d|%d[a];[%d:a][q][a]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,apad[aud]'
             % (a0 + 1, t_q * 1000, t_q * 1000, a0 + 2, t_ans * 1000, t_ans * 1000, a0))
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error'] + vin +
                   ['-i', str(tmp / 'a_hook.mp3'), '-i', str(tmp / 'a_q.mp3'), '-i', str(tmp / 'a_ans.mp3'),
                    '-filter_complex', graph, '-map', '[v]', '-map', '[aud]', '-t', '%.2f' % total,
                    '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
                    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(mp4)], check=True)

    # текст поста: на каждой площадке своя метка, чтобы в статистике было видно, откуда пришли
    lvl = meta['level'].lower()
    def link(src): return 'https://qazaqtrainer.com/kk/%s/%s/?utm_source=%s&utm_medium=short' % (meta['exam'], lvl, src)
    tags = '#казтест #қазтест #qazresmitest #қазақтілі #казахскийязык #қазақшаүйрену #%s' % meta['level'].lower()
    caption = (hook[0] + ' / ' + hook[1] + '\n\n' + q['text'] + '\nЖауабы видеоның соңында. Ответ в конце видео.\n\n'
               'Толық сынақ тесттер біздің сайтта / Полные пробные тесты на сайте: {link}\nКүн сайын тапсырма / Задание дня: t.me/qazaqtrainer\n\n' + tags)
    txt = out_dir / (name + '.txt')
    txt.write_text('\n\n'.join('=== %s ===\n%s' % (p, caption.format(link=link(p))) for p in ('tiktok', 'instagram', 'youtube')) + '\n')
    print('%s  %.1f с  %d КБ  %s\n%s' % (mp4, total, mp4.stat().st_size // 1024, v.split('-')[2].replace('Neural', ''), txt))
    return mp4

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 2: sys.exit(__doc__)
    opt = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    build(args[0], args[1], pathlib.Path(opt.get('out', ROOT.parent / 'соцсети' / 'проба')), opt.get('voice'), mute='--mute' in sys.argv)
