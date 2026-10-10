#!/usr/bin/env python3
"""Ролики по сценариям недели (банк на 28 дней) — TikTok и Instagram Reels, копия в Telegram.

Запуск:  python3 tools/social/reels.py ../соцсети/неделя-01/сценарии.json [id …] [--mute] [--check]
  --check  только проверка казахского и сводка, без озвучки и сборки
  --mute   без озвучки (посмотреть вёрстку): паузы вместо голоса

Шаблоны (поле type): cards — карточки слов (слот «Язык»), quiz — вопрос с вариантами и отсчётом, poll — опрос.
Голос только казахский и один на ролик, русский только на экране (решение владельца 10.10.2026). Один призыв на
ролик: cta = "S" (сайт) или "T" (Телеграм). Разбора в квизе нет, на экране только короткая пометка note.

Казахский — самое чувствительное место. Поля с казахским: *_kk, say, kk у карточек, options при options_lang=kk.
Перед сборкой они проходят kk_check.py; SWAP и RARE вне kk_allow.txt останавливают сборку. Варианты, которые
неверны намеренно (wrong_ok), не проверяются, но попадают в список для носителя отдельной пометкой.
Рядом с роликами кладутся: <id>.txt (подписи), обзор-N.png (кадры всех роликов), казахский-на-проверку.md."""
import hashlib, json, pathlib, random, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import make_short as ms, kk_check

W, H = ms.W, ms.H
TTS_CACHE = ms.ROOT.parent / 'соцсети' / '_tts'
EMOJI_FONT = '/System/Library/Fonts/Apple Color Emoji.ttc'
BOTTOM = 1740            # ниже подпись qazaqtrainer.com: содержимое кадра не должно туда заходить
DUR = (12, 45)           # допустимая длина ролика, с
BADGE = {'cards': 'Qazaq Trainer · Тіл сабағы', 'quiz': 'Qazaq Trainer · Өзіңді тексер', 'poll': 'Qazaq Trainer · Сауалнама'}
HOOK_DEFAULT = ('Жауабын білесіз бе?', 'Знаете ответ?')
# один призыв на ролик (решение владельца 10.10.2026); казахские строки взяты из одобренной концовки make_short
CTA = {
    'S': {'say': 'Толық сынақ тесттер біздің сайтта.', 'kk': 'Толық сынақ тесттер біздің сайтта',
          'ru': 'Полные пробные тесты на нашем сайте', 'url': 'qazaqtrainer.com'},
    'T': {'say': 'Күн сайынғы тапсырмалар Телеграм арнамызда.', 'kk': 'Күн сайынғы тапсырмалар Телеграм арнамызда',
          'ru': 'Задания каждый день в нашем Телеграм-канале', 'url': 't.me/qazaqtrainer'},
}
TAGS = '#казахскийязык #қазақтілі #казтест #қазтест #qazresmitest #учимказахский'

# ---------- казахский: что проверять ----------
def kk_fields(v):
    """[(где, строка, намеренно_неверно)] — все казахские строки ролика, включая голос."""
    out = []
    def add(where, s, wrong=False):
        if s: out.append((where, s, wrong))
    if v.get('hook'): add('крючок', v['hook'].get('kk')); add('крючок, голос', v['hook'].get('say'))
    for i, c in enumerate(v.get('cards', [])):
        add('карточка %d' % (i + 1), c.get('kk')); add('карточка %d, голос' % (i + 1), c.get('say'))
    q = v.get('q') or {}
    add('вопрос', q.get('kk')); add('вопрос, голос', q.get('say')); add('ответ, голос', v.get('say_answer'))
    if v.get('options_lang') == 'kk':
        for i, o in enumerate(v.get('options', [])):
            t = o['t'] if isinstance(o, dict) else o
            add('вариант %s' % 'ABCD'[i], t, wrong=(i != v.get('answer') and v.get('wrong_ok')))
    for i, o in enumerate(v.get('poll', [])): add('вариант опроса %d' % (i + 1), o.get('kk'))
    add('призыв', CTA[v['cta']]['kk']); add('призыв, голос', CTA[v['cta']]['say'])
    return out

def check_kk(videos):
    """Возвращает (блокирующие, все замечания по роликам)."""
    blocking, per = [], {}
    for v in videos:
        texts = [s for _, s, wrong in kk_fields(v) if not wrong]
        issues = kk_check.check(texts)
        per[v['id']] = issues
        blocking += [(v['id'],) + i for i in issues if i[0] in ('SWAP', 'RARE')]
    return blocking, per

def plain_checks(v):
    """Длинное тире и латинский «Telegram» — решения владельца 10.10.2026."""
    errs = []
    for where, s, _ in kk_fields(v):
        if '—' in s: errs.append('%s: длинное тире' % where)
        if 'telegram' in s.lower(): errs.append('%s: Telegram латиницей' % where)
    blob = json.dumps(v, ensure_ascii=False)
    if '—' in blob: errs.append('длинное тире в сценарии')
    return errs

# ---------- озвучка с кэшем: пересборка ролика не тратит лимит Azure ----------
def tts(text, voice, mute):
    text = ms.nodash(text)
    TTS_CACHE.mkdir(parents=True, exist_ok=True)
    path = TTS_CACHE / (hashlib.sha1((voice + '|' + text).encode()).hexdigest()[:16] + '.mp3')
    if mute:
        sec = 0.8 + len(text) / 14
        path = pathlib.Path(tempfile.mkdtemp()) / 'mute.mp3'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '%.2f' % sec, str(path)], check=True)
    elif not path.exists():
        ms.tts(text, voice, path)
    return path, ms.duration(path)

# ---------- рисование ----------
_emoji = {}
def emoji(ch, size):
    if ch not in _emoji:
        f = ImageFont.truetype(EMOJI_FONT, 160)   # у цветного шрифта Apple только размер 160
        im = Image.new('RGBA', (240, 240)); ImageDraw.Draw(im).text((120, 120), ch, font=f, embedded_color=True, anchor='mm')
        _emoji[ch] = im.crop(im.getbbox())
    e = _emoji[ch]; k = size / max(e.size)
    return e.resize((round(e.size[0] * k), round(e.size[1] * k)), Image.LANCZOS)

def fit(d, text, name, size, width):
    """Шрифт, при котором строка влезает в ширину (длинные слова не переносим)."""
    while size > 40 and d.textlength(text, font=ms.font(name, size)) > width: size -= 4
    return ms.font(name, size)

def draw_marked(d, text, f, cy, mark):
    """Слово по центру, буква mark подсвечена золотым (для ролика про казахские буквы)."""
    x = (W - d.textlength(text, font=f)) / 2
    for ch in text:
        d.text((x, cy), ch, font=f, fill=ms.GOLD if mark and ch.lower() == mark else ms.WHITE, anchor='lm')
        x += d.textlength(ch, font=f)

def frame_card(v, c, idx, n, path):
    im, d = ms.base({'badge': BADGE['cards']})
    d.text((W - 80, 205), '%d/%d' % (idx, n), font=ms.font('Arial Bold.ttf', 40), fill='#d8ecf1', anchor='rm')
    parts = []   # (высота, рисовалка)
    if c.get('big'):
        fb = fit(d, c['big'], 'Arial Bold.ttf', 300, W - 160)
        parts.append((330, lambda y, fb=fb: d.text((W / 2, y + 165), c['big'], font=fb, fill=ms.GOLD if c.get('mark') else ms.WHITE, anchor='mm')))
    if c.get('emoji'):
        e = emoji(c['emoji'], 230 if c.get('big') else 300)
        parts.append((e.size[1] + 40, lambda y, e=e: im.paste(e, (int((W - e.size[0]) / 2), int(y + 20)), e)))
    fk = fit(d, c['kk'], 'Arial Bold.ttf', 130, W - 160)
    parts.append((170, lambda y: draw_marked(d, c['kk'], fk, y + 85, c.get('mark'))))
    if c.get('ru'):
        fr = ms.font('Arial.ttf', 64)
        h = len(ms.wrap(d, c['ru'], fr, W - 160)) * 80
        parts.append((h + 20, lambda y: ms.text_block(d, c['ru'], fr, 80, y + 20, W - 160, '#d8ecf1', center=True)))
    total = sum(h for h, _ in parts)
    y = 300 + (BOTTOM - 300 - total) / 2
    for h, draw in parts: draw(y); y += h
    im.save(path)
    return y

def frame_poll(v, path):
    im, d = ms.base({'badge': BADGE['poll']})
    q = v['q']
    y = ms.text_block(d, q['kk'], ms.font('Arial Bold.ttf', 80), 80, 360, W - 160, ms.WHITE, center=True)
    y = ms.text_block(d, q['ru'], ms.font('Arial.ttf', 50), 80, y + 20, W - 160, '#d8ecf1', center=True) + 60
    for o in v['poll']:
        hgt = 150
        d.rounded_rectangle([110, y, W - 110, y + hgt], 30, fill=ms.WHITE)
        x = 150
        if o.get('emoji'):
            e = emoji(o['emoji'], 90); im.paste(e, (x, int(y + (hgt - e.size[1]) / 2)), e); x += 130
        d.text((x, y + 48), o['kk'], font=ms.font('Arial Bold.ttf', 56), fill=ms.INK, anchor='lm')
        d.text((x, y + 108), o['ru'], font=ms.font('Arial.ttf', 40), fill=ms.MUTED, anchor='lm')
        y += hgt + 30
    y = ms.text_block(d, v.get('ask', 'Пиши ответ в комментариях'), ms.font('Arial Bold.ttf', 52), 80, y + 40, W - 160, ms.GOLD, center=True)
    im.save(path)
    return y

def frame_cta(v, path):
    c = CTA[v['cta']]
    im, d = ms.base({'badge': BADGE[v['type']]})
    d.ellipse([W / 2 - 120, 480, W / 2 + 120, 720], fill=ms.WHITE)
    d.text((W / 2, 600), 'Q', font=ms.font('Georgia Bold.ttf', 170), fill=ms.TEAL, anchor='mm')
    y = ms.text_block(d, c['kk'], ms.font('Arial Bold.ttf', 70), 80, 820, W - 160, ms.WHITE, center=True)
    y = ms.text_block(d, c['ru'], ms.font('Arial.ttf', 46), 80, y + 25, W - 160, '#d8ecf1', center=True)
    y = ms.text_block(d, c['url'], fit(d, c['url'], 'Arial Bold.ttf', 84, W - 160), 80, y + 70, W - 160, ms.GOLD, center=True)
    im.save(path)
    return y

# ---------- сборка ----------
def assemble(segs, mp4):
    """segs: [(png, длительность, mp3 или None)]; голос стартует вместе со своим кадром (+0,15 с)."""
    vin, ain, delays, t = [], [], [], 0.0
    for png, dur, mp3 in segs:
        vin += ['-loop', '1', '-framerate', '30', '-t', '%.3f' % dur, '-i', str(png)]
        if mp3: ain.append(mp3); delays.append(int((t + 0.15) * 1000))
        t += dur
    n = len(segs)
    graph = ''.join('[%d:v]' % i for i in range(n)) + 'concat=n=%d:v=1:a=0[v];' % n
    graph += ''.join('[%d:a]adelay=%d|%d[a%d];' % (n + i, ms_, ms_, i) for i, ms_ in enumerate(delays))
    # громкость как в make_short: ровное усиление и ограничитель, без loudnorm (решение владельца 10.10.2026)
    graph += ''.join('[a%d]' % i for i in range(len(ain))) + 'amix=inputs=%d:normalize=0,volume=9dB,alimiter=limit=0.89:level=false,apad[aud]' % len(ain)
    cmd = ['ffmpeg', '-y', '-loglevel', 'error'] + vin + sum((['-i', str(a)] for a in ain), []) + [
        '-filter_complex', graph, '-map', '[v]', '-map', '[aud]', '-t', '%.2f' % t, '-r', '30', '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(mp4)]
    subprocess.run(cmd, check=True)
    return t

def build(v, out, mute):
    voice = v.get('voice') or ms.voice_for(v['id'], '')
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='reel-'))
    segs, bottoms, keys = [], [], []   # keys — кадры для обзорного листа
    def seg(png, dur, mp3=None, key=False):
        segs.append((png, dur, mp3))
        if key: keys.append(png)
    if v['type'] in ('cards', 'quiz'):
        hook = v.get('hook') or {'kk': HOOK_DEFAULT[0], 'ru': HOOK_DEFAULT[1]}
        a, dur = tts(hook.get('say') or hook['kk'], voice, mute)
        ms.frame_hook({'badge': BADGE[v['type']]}, (hook['kk'], hook['ru']), tmp / 'hook.png')
        seg(tmp / 'hook.png', max(2.2, dur + 0.5), a, key=True)
    if v['type'] == 'cards':
        for i, c in enumerate(v['cards']):
            p = tmp / ('c%02d.png' % i)
            bottoms.append(('карточка %d' % (i + 1), frame_card(v, c, i + 1, len(v['cards']), p)))
            a, dur = tts(c.get('say') or c['kk'], voice, mute)
            seg(p, max(1.2, dur + 0.35), a, key=i in (0, len(v['cards']) - 1))   # план: «Язык» 15–25 с
    elif v['type'] == 'quiz':
        opts = [o['t'] if isinstance(o, dict) else o for o in v['options']]
        order = list(range(len(opts))); random.Random(v['id']).shuffle(order)   # ключ не всегда на месте A
        q = {'text': v['q'].get('kk') or v['q']['ru'], 'sub': v['q']['ru'] if v['q'].get('kk') else '',
             'options': [opts[i] for i in order], 'answer': order.index(v['answer'])}
        meta = {'badge': BADGE['quiz']}
        a, dur = tts(v['q']['say'], voice, mute)
        bottoms.append(('вопрос', ms.frame_question(meta, q, tmp / 'q.png')))
        seg(tmp / 'q.png', max(3.0, dur + 0.7), a, key=True)
        for c in range(ms.COUNTDOWN, 0, -1):
            bottoms.append(('отсчёт', ms.frame_question(meta, q, tmp / ('n%d.png' % c), count=c) + 0))
            seg(tmp / ('n%d.png' % c), 1.0)
        note = (v['note'], '') if v.get('note') else None
        bottoms.append(('ответ', ms.frame_question(meta, q, tmp / 'ans.png', reveal=True, explain=note)))
        a, dur = tts(v['say_answer'], voice, mute)
        seg(tmp / 'ans.png', max(3.0, dur + 1.2), a, key=True)
    elif v['type'] == 'poll':
        bottoms.append(('опрос', frame_poll(v, tmp / 'poll.png')))
        a, dur = tts(v['q']['say'], voice, mute)
        seg(tmp / 'poll.png', dur + 4.0, a, key=True)
    bottoms.append(('призыв', frame_cta(v, tmp / 'cta.png')))
    a, dur = tts(CTA[v['cta']]['say'], voice, mute)
    seg(tmp / 'cta.png', max(3.5, dur + 1.2), a, key=True)

    mp4 = out / (v['id'] + '.mp4')
    total = assemble(segs, mp4)
    problems = ['%s: текст заходит на подпись внизу (до %d px)' % (w, b) for w, b in bottoms if b > BOTTOM]
    if not DUR[0] <= total <= DUR[1]: problems.append('длина %.1f с вне %d–%d с' % (total, *DUR))
    write_caption(v, out)
    return total, voice, keys, problems

def write_caption(v, out):
    """Подписи: TikTok и Instagram (ссылка в профиле, в подписи она не кликается) и копия в Telegram-канал."""
    hook = v.get('hook') or {'kk': v['q'].get('kk', ''), 'ru': v['q']['ru']}
    head = '%s / %s' % (hook['kk'], hook['ru']) if hook.get('kk') else hook['ru']
    body = v.get('caption', '')
    cta_social = {'S': 'Полные пробные тесты ҚАЗТЕСТ и QazResmiTest: ссылка в профиле.',
                  'T': 'Задание каждый день в Телеграм-канале t.me/qazaqtrainer (ссылка в профиле).'}[v['cta']]
    # в самом канале звать в канал незачем: у роликов с призывом «Т» копия в Telegram идёт без призыва
    cta_tg = 'Полные пробные тесты: https://qazaqtrainer.com/?utm_source=telegram&utm_medium=short&utm_campaign=%s' % v['campaign'] if v['cta'] == 'S' else ''
    parts = {'tiktok': [head, body, cta_social, TAGS], 'instagram': [head, body, cta_social, TAGS], 'telegram': [head, body, cta_tg]}
    (out / (v['id'] + '.txt')).write_text('\n\n'.join('=== %s ===\n%s' % (k, '\n\n'.join(ms.nodash(x) for x in p if x)) for k, p in parts.items()) + '\n')

def contact_sheets(rows, out):
    """Обзорный лист: колонка на ролик, в ней ключевые кадры. Один взгляд на неделю вместо сотни кадров."""
    tw, th, per = 216, 384, 7
    for s in range(0, len(rows), per):
        chunk = rows[s:s + per]
        nrow = max(len(k) for _, k in chunk)
        sheet = Image.new('RGB', (tw * len(chunk), th * nrow + 50), '#ffffff'); d = ImageDraw.Draw(sheet)
        for c, (vid, keys) in enumerate(chunk):
            d.text((c * tw + 8, 12), vid, font=ms.font('Arial Bold.ttf', 22), fill='#000000')
            for r, k in enumerate(keys):
                sheet.paste(Image.open(k).resize((tw - 4, th - 4)), (c * tw + 2, 50 + r * th + 2))
        sheet.save(out / ('обзор-%d.png' % (s // per + 1)))

def native_sheet(videos, per, out):
    """Всё казахское за неделю на одной странице — для носителя."""
    L = ['# Казахский в роликах: на проверку носителю', '',
         'Проверить правописание, окончания и естественность. Помечено: ⚠ — нет в корпусе книг или редкое,',
         '◦ — сочетание слов в книгах не встретилось (не обязательно ошибка). «Намеренно неверно» — неправильный',
         'вариант в квизе, он и должен быть неверным; проверить, что он неверен именно так, как задумано.', '']
    for v in videos:
        L += ['## %s · %s %s' % (v['id'], v['date'], v['slot']), '']
        flags = per.get(v['id'], [])
        for where, s, wrong in kk_fields(v):
            low = kk_check.norm(s)
            mark = ''
            if any(i[0] in ('SWAP', 'RARE') and i[1] == low for i in flags): mark = ' ⚠ ' + ', '.join('%s (%s)' % (i[2], i[3]) for i in flags if i[1] == low and i[0] in ('SWAP', 'RARE'))
            pairs = [i[2] for i in flags if i[1] == low and i[0] == 'PAIR']
            if pairs: mark += ' ◦ ' + ', '.join(pairs)
            allowed = [w for w in kk_check.WORD.findall(low) if w in kk_check.ALLOW and not kk_check.ALLOW[w].startswith('носитель')]
            if allowed: mark += ' ⚠ ' + '; '.join('%s: %s' % (w, kk_check.ALLOW[w]) for w in allowed)
            ru = ''
            for c in v.get('cards', []):
                if s == c.get('kk') and c.get('ru'): ru = ' (%s)' % c['ru']
            L.append('- %s: **%s**%s%s%s' % (where, s, ru, ' (намеренно неверно)' if wrong else '', mark))
        L.append('')
    (out / 'казахский-на-проверку.md').write_text('\n'.join(L))

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args: sys.exit(__doc__)
    src = pathlib.Path(args[0]).resolve(); data = json.loads(src.read_text())
    out = src.parent
    videos = [dict(v, campaign=data['campaign']) for v in data['videos']]
    if args[1:]: videos = [v for v in videos if v['id'] in args[1:]]
    blocking, per = check_kk(videos)
    errs = [(v['id'], e) for v in videos for e in plain_checks(v)]
    native_sheet(videos, per, out)
    for b in blocking: print('КАЗАХСКИЙ %s: %s %s (%s)  [%s]' % (b[0], b[1], b[3], b[4], b[2]))
    for vid, e in errs: print('ПРАВИЛО %s: %s' % (vid, e))
    if blocking or errs: sys.exit('сборка остановлена: исправить или подтвердить в kk_allow.txt')
    print('казахский: блокирующих замечаний нет; список для носителя: %s' % (out / 'казахский-на-проверку.md'))
    if '--check' in sys.argv: return
    rows = []
    for v in videos:
        total, voice, keys, problems = build(v, out, '--mute' in sys.argv)
        rows.append((v['id'], keys))
        print('%-22s %5.1f с  %-6s %s' % (v['id'], total, voice.split('-')[2].replace('Neural', ''), '; '.join(problems) or 'ок'))
    contact_sheets(rows, out)

if __name__ == '__main__':
    main()
