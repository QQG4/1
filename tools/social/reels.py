#!/usr/bin/env python3
"""Ролики по сценариям недели (банк на 28 дней) — TikTok и Instagram Reels, копия в Telegram.

Запуск:  python3 tools/social/reels.py ../соцсети/неделя-01/сценарии.json [id …] [--mute] [--check]
  --check  только проверка казахского и сводка, без озвучки и сборки
  --mute   без озвучки (посмотреть вёрстку): паузы вместо голоса

Шаблоны (поле type): cards — карточки слов (слот «Язык»), quiz — вопрос с вариантами и отсчётом, poll — опрос,
tip — «Разбор»: шаги с голосом и субтитрами поверх скриншотов сайта (кадры снимает shots.mjs) или карточки-схемы,
story — «История»: «типичная ситуация» фразами на экране, последняя фраза — вывод.
Голос один на ролик (решение владельца 10.10.2026): в cards/quiz/poll казахский, русский только на экране; в tip/story
русский, казахские слова только на экране (в голосе казахских букв быть не должно — проверяется). Один призыв на
ролик: cta = "S" (сайт) или "T" (Телеграм). Разбора в квизе нет, на экране только короткая пометка note.
Первая секунда (26.10.2026): заставки нет, с 0,0 с на экране вопрос, слово или первый шаг, голос сразу; тема
(topic или hook.ru) — строкой в шапке всех кадров. Длина по шаблону — DUR.

Казахский — самое чувствительное место. Поля с казахским: *_kk, say, kk у карточек, options при options_lang=kk.
Перед сборкой они проходят kk_check.py; SWAP и RARE вне kk_allow.txt останавливают сборку. Варианты, которые
неверны намеренно (wrong_ok), не проверяются, но попадают в список для носителя отдельной пометкой.
Рядом с роликами кладутся: <id>.txt (подписи), обзор-N.png (кадры всех роликов), казахский-на-проверку.md."""
import difflib, hashlib, json, pathlib, re, shutil, random, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import make_short as ms, kk_check

W, H = ms.W, ms.H
TTS_CACHE = ms.ROOT.parent / 'соцсети' / '_tts'
RATE = '+12%'   # 11.10.2026 владелец: «медленно, можно быстрее на 15–20 %»; было -5 %, стало +12 %. Темп утверждён
SENT_GAP = 0.15       # пауза между предложениями внутри фразы: «миллисекунды и сразу дальше, не терять внимание» (11.10.2026)
STEP_GAP = 0.25        # пауза между шагами «Разбора» и «Истории» (было 0,5 с)
EMOJI_FONT = '/System/Library/Fonts/Apple Color Emoji.ttc'
BOTTOM = 1740            # ниже подпись qazaqtrainer.com: содержимое кадра не должно туда заходить
# Длина по шаблону (решение владельца 26.10.2026 по аналитике 12–26.10: смотрят 2–5 с, лучше всех держат «Дни недели»
# 18 с и квиз 16 с). Короткие слоты 11–18 с, «Разбор» и «История» около 20 с. Было 10–45 с на всё
DUR = {'cards': (11, 18), 'quiz': (11, 18), 'poll': (11, 18), 'tip': (11, 22), 'story': (11, 22)}
LEAD = 0.15              # голос вступает через 0,15 с после смены кадра; у первого кадра 0: голос с 0,0 с
BADGE = {'cards': 'Qazaq Trainer · Тіл сабағы', 'quiz': 'Qazaq Trainer · Өзіңді тексер', 'poll': 'Qazaq Trainer · Сауалнама',
         'tip': 'Qazaq Trainer · Талдау', 'story': 'Qazaq Trainer · Оқиға'}
RU_TYPES = ('tip', 'story')
# русские голоса в той же пропорции, что Daulet и Aigul: мужской в двух роликах из трёх
RU_VOICE = {ms.DAULET: 'ru-RU-DmitryNeural', ms.AIGUL: 'ru-RU-SvetlanaNeural'}
KK_LETTERS = set('әғқңөұүһіӘҒҚҢӨҰҮҺІ')
# На стыке языков голос спотыкается (замечание владельца 10.10.2026: «КАЗТЕСТ или КазРесми Тест», «к Болашаку» резали
# слух). Правило: в голосе только слова языка этого голоса, названия на чужом языке — только на экране (поле text).
# Список пополнять, когда голос споткнётся на новом слове.
FOREIGN_RU = re.compile(r'[A-Za-z]+|(?i:казтест|каз ?ресми|болаша[кг]|наурыз|жұма)')
# один призыв на ролик (решение владельца 10.10.2026); казахские строки взяты из одобренной концовки make_short
CTA = {
    'S': {'say': 'Толық сынақ тесттер біздің сайтта.', 'kk': 'Толық сынақ тесттер біздің сайтта',
          'ru': 'Полные пробные тесты на нашем сайте', 'url': 'qazaqtrainer.com'},
    'T': {'say': 'Күн сайынғы тапсырмалар Телеграм арнамызда.', 'kk': 'Күн сайынғы тапсырмалар Телеграм арнамызда',
          'ru': 'Задания каждый день в нашем Телеграм-канале', 'url': 't.me/qazaqtrainer'},
}
# «Ссылка в профиле» не используем (26.10.2026): в TikTok она не кликается до 1 000 подписчиков. Адрес — на экране
CTA_RU = {'S': 'Полные пробные тесты на нашем сайте.', 'T': 'Задания каждый день в нашем Телеграм-канале.'}
# подписи TikTok и Instagram: адрес текстом (ссылки в подписи не кликаются), канал ищется поиском внутри Телеграма.
# «@qazaqtrainer» не пишем: в TikTok это упоминание чужого аккаунта
CTA_SOCIAL = {'S': 'Полные пробные тесты ҚАЗТЕСТ и QazResmiTest на сайте qazaqtrainer.com',
              'T': 'Задание каждый день в Телеграм-канале t.me/qazaqtrainer: найди qazaqtrainer поиском в Телеграме.'}
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
    add('вопрос', q.get('kk'), wrong=v.get('q_wrong')); add('вопрос, голос', q.get('say'))   # q_wrong: «найди ошибку»; add('ответ, голос', v.get('say_answer'))
    if v.get('options_lang') == 'kk':
        for i, o in enumerate(v.get('options', [])):
            t = o['t'] if isinstance(o, dict) else o
            add('вариант %s' % 'ABCD'[i], t, wrong=(i != v.get('answer') and v.get('wrong_ok')))
    for i, o in enumerate(v.get('poll', [])): add('вариант опроса %d' % (i + 1), o.get('kk'))
    for i, st in enumerate(v.get('steps', [])):
        add('шаг %d, на экране' % (i + 1), st.get('kk'))
        card = st.get('card') or {}
        for w in kk_check.WORD.findall(' '.join([st.get('text') or '', card.get('title', '')]).lower()):
            if KK_LETTERS & set(w): add('шаг %d, слово в субтитре' % (i + 1), w)
        # строки карточки проверяем целиком: в них бывают примеры-предложения; card.wrong — номера строк,
        # неверных намеренно («было: …» в разборе ошибок)
        for j, line in enumerate(card.get('lines', [])):
            kk_part = line.split(': ', 1)[1] if line.startswith(('Было: ', 'Надо: ')) else line
            if KK_LETTERS & set(kk_part.lower()) or j in card.get('wrong', []):
                add('шаг %d, карточка' % (i + 1), kk_part, wrong=j in card.get('wrong', []))
    add('призыв', CTA[v['cta']]['kk'])
    if v['type'] not in RU_TYPES: add('призыв, голос', CTA[v['cta']]['say'])
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
        if 'голос' in where and re.search('[A-Za-z]', s): errs.append('%s: латиница в казахском голосе' % where)
    if v['type'] in RU_TYPES:
        for i, st in enumerate(v['steps']):
            say = st.get('say', '')
            if KK_LETTERS & set(say): errs.append('шаг %d: казахские буквы в русском голосе' % (i + 1))
            if FOREIGN_RU.search(say): errs.append('шаг %d: казахское или латинское название в русском голосе: «%s»' % (i + 1, FOREIGN_RU.search(say).group()))
            if 'telegram' in say.lower(): errs.append('шаг %d: Telegram латиницей' % (i + 1))
            if len(st.get('text') or say) > 120: errs.append('шаг %d: субтитр длиннее 120 знаков' % (i + 1))
    blob = json.dumps(v, ensure_ascii=False)
    if '—' in blob: errs.append('длинное тире в сценарии')
    if 'в профиле' in blob: errs.append('«ссылка в профиле»: в TikTok не кликается, писать адрес или звать в Телеграм')
    if '📅' in blob: errs.append('эмодзи 📅: у Apple на нём дата «JUL 17», брать 🗓')
    return errs

# ---------- озвучка с кэшем: пересборка ролика не тратит лимит Azure ----------
def tts(text, voice, mute):
    text = ms.nodash(text)
    TTS_CACHE.mkdir(parents=True, exist_ok=True)
    if mute:
        sec = 0.8 + len(text) / 14
        path = pathlib.Path(tempfile.mkdtemp()) / 'mute.mp3'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '%.2f' % sec, str(path)], check=True)
        return path, ms.duration(path)
    # Несколько предложений озвучиваем по отдельности и склеиваем с паузой SENT_GAP: Azure держит на точке ~1 с,
    # а точная пауза в SSML ужимает её только до ~0,5 с (замер 11.10.2026). Интонация конца сохраняется:
    # каждое предложение синтезируется целиком, со своей точкой или вопросом. asetnsamples после склейки: без него
    # кодировщик mp3 иногда падал («inadequate AVFrame plane padding»)
    parts = [x for x in re.split(r'(?<=[.?!…])\s+', text.strip()) if x]
    path = TTS_CACHE / (hashlib.sha1(('v4|%s|%s|%s|%s' % (RATE, SENT_GAP, voice, text)).encode()).hexdigest()[:16] + '.mp3')
    if path.exists(): return path, ms.duration(path)
    if len(parts) > 1:
        files = [tts(x, voice, mute)[0] for x in parts]
        gap = TTS_CACHE / ('gap-%d.mp3' % int(SENT_GAP * 1000))
        if not gap.exists():
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', str(SENT_GAP), '-b:a', '96k', str(gap)], check=True)
        seq = [f for x in files for f in (x, gap)][:-1]
        inputs = sum((['-i', str(f)] for f in seq), [])
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error'] + inputs + ['-filter_complex', ''.join('[%d:a]' % i for i in range(len(seq))) +
                        'concat=n=%d:v=0:a=1,asetnsamples=n=1152:p=0[a]' % len(seq), '-map', '[a]', '-b:a', '96k', str(path)], check=True)
        return path, ms.duration(path)
    raw = path.with_suffix('.raw.mp3'); ms.tts(text, voice, raw, rate=RATE)
    # Azure оставляет ~0,5 с тишины по краям: на карточках из одного слова это треть кадра, темп проседал.
    # Порог -60 дБ и запас 0,05 с: при -50 дБ без запаса срезались тихие хвосты слов (замечание владельца 11.10.2026)
    one = 'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.05'
    trim = ','.join([one, 'areverse', one, 'areverse'])
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(raw), '-af', trim, '-b:a', '96k', str(path)], check=True)
    raw.unlink()
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

HEAD_TOP = 280
def header(d, text, size=64, fill=ms.GOLD):
    """Тема ролика строкой под плашкой, на всех кадрах (26.10.2026). Заставки-крючка больше нет: с 0,0 с на экране
    материал, а тема видна и тем, кто пролистал первые секунды. Не больше двух строк. Возвращает нижний край."""
    text = ' '.join(ms.nodash(text).split())
    while size > 44 and len(ms.wrap(d, text, ms.font('Arial Bold.ttf', size), W - 160)) > 2: size -= 4
    return ms.text_block(d, text, ms.font('Arial Bold.ttf', size), 80, HEAD_TOP, W - 160, fill, center=True)

def topic(v):
    """Тема для строки header: поле topic, иначе русская строка бывшего крючка."""
    return v.get('topic') or (v.get('hook') or {}).get('ru')

def marked(text, mark):
    """Какие позиции подсветить: одна буква — все её вхождения (ролик про буквы); несколько букв — последнее
    вхождение (окончание: мектеп|ке|, кітаб|ым|, бар|ма|дым — для середины слова mark пишется «ма»)."""
    if not mark: return set()
    low = text.lower()
    if len(mark) == 1 and ' ' not in low: return {i for i, ch in enumerate(low) if ch == mark}   # «оның кітабы»: только окончание
    i = low.rfind(mark)
    return set(range(i, i + len(mark))) if i >= 0 else set()

def draw_marked(d, text, f, cy, mark):
    """Слово по центру, буквы mark подсвечены золотым."""
    x = (W - d.textlength(text, font=f)) / 2
    hl = marked(text, mark)
    for i, ch in enumerate(text):
        d.text((x, cy), ch, font=f, fill=ms.GOLD if i in hl else ms.WHITE, anchor='lm')
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
    if fk.size >= 84 or c.get('mark'):
        parts.append((170, lambda y: draw_marked(d, c['kk'], fk, y + 85, c.get('mark'))))
    else:   # пример-предложение: переносим строки, а не мельчим шрифт
        fs = ms.font('Arial Bold.ttf', 84)
        h = len(ms.wrap(d, c['kk'], fs, W - 160)) * 105
        parts.append((h + 30, lambda y: ms.text_block(d, c['kk'], fs, 80, y + 15, W - 160, ms.WHITE, center=True)))
    if c.get('ru'):
        fr = ms.font('Arial.ttf', 64)
        h = len(ms.wrap(d, c['ru'], fr, W - 160)) * 80
        parts.append((h + 20, lambda y: ms.text_block(d, c['ru'], fr, 80, y + 20, W - 160, '#d8ecf1', center=True)))
    top = header(d, topic(v), 54, '#d8ecf1') + 20 if topic(v) else 300
    total = sum(h for h, _ in parts)
    y = top + (BOTTOM - top - total) / 2
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
    big, small = (c['ru'], c['kk']) if v['type'] in RU_TYPES else (c['kk'], c['ru'])   # крупно — язык голоса
    y = ms.text_block(d, big, ms.font('Arial Bold.ttf', 70), 80, 820, W - 160, ms.WHITE, center=True)
    y = ms.text_block(d, small, ms.font('Arial.ttf', 46), 80, y + 25, W - 160, '#d8ecf1', center=True)
    y = ms.text_block(d, c['url'], fit(d, c['url'], 'Arial Bold.ttf', 84, W - 160), 80, y + 70, W - 160, ms.GOLD, center=True)
    im.save(path)
    return y

SUB_TOP = 1420   # субтитры «Разбора» и «Истории» — в нижней части кадра, над подписью сайта

def draw_words(d, text, f, y, line_h, width, fill, shown, anchor='lm'):
    """Текст по центру строками; видны только первые shown слов (None — все). Раскладка строится по всему тексту,
    поэтому строки не прыгают, пока слова проявляются. y — центр первой строки (lm) или её верх (la)."""
    k = 0
    for line in ms.wrap(d, text, f, width):
        x = (W - d.textlength(line, font=f)) / 2
        for w in line.split(' '):
            if shown is None or k < shown: d.text((x, y), w, font=f, fill=fill, anchor=anchor)
            x += d.textlength(w + ' ', font=f); k += 1
        y += line_h
    return y

def subtitle(d, text, y0=SUB_TOP, shown=None):
    """Субтитр: белая плашка, тёмный текст, слова проявляются по мере озвучки. Требование банка: субтитры крупно."""
    f = ms.font('Arial Bold.ttf', 54)
    text = ' '.join(ms.nodash(text).split())
    h = len(ms.wrap(d, text, f, W - 220)) * 70 + 50
    y0 = min(y0, BOTTOM - 10 - h)   # длинный субтитр поднимается и ложится на низ скриншота, но не на подпись сайта
    d.rounded_rectangle([60, y0, W - 60, y0 + h], 30, fill=ms.WHITE)
    draw_words(d, text, f, y0 + 60, 70, W - 220, ms.INK, shown)
    return y0 + h

def scheme(im, d, card, y0, y1):
    """Карточка-схема (план недели, вывод): заголовок и строки, текущая строка подсвечена. Высота по содержимому,
    карточка по центру между y0 и y1 (растянутая на весь кадр выглядела пустой). Возвращает нижний край."""
    ft, fl, fb = ms.font('Arial Bold.ttf', 70), ms.font('Arial.ttf', 60), ms.font('Arial Bold.ttf', 60)
    probe = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    title_h = ms.text_block(probe, card['title'], ft, 0, 0, W - 260, ms.TEAL)
    rows = [ms.wrap(probe, line, fb if card.get('hl') == i else fl, W - 340) for i, line in enumerate(card.get('lines', []))]
    h = 60 + title_h + 20 + sum(len(r) * 76 + 40 for r in rows) + 40
    top = y0 + max(0, (y1 - y0 - h) / 2)
    d.rounded_rectangle([80, top, W - 80, top + h], 40, fill=ms.WHITE)
    y = ms.text_block(d, card['title'], ft, 130, top + 60, W - 260, ms.TEAL) + 20
    for i, r in enumerate(rows):
        hl = card.get('hl') == i
        rh = len(r) * 76 + 24
        if hl: d.rounded_rectangle([110, y, W - 110, y + rh], 24, fill=ms.GOLD)
        yy = y + 12
        for line in r: d.text((160, yy + 38), line, font=fb if hl else fl, fill=ms.INK, anchor='lm'); yy += 76
        y += rh + 16
    return top + h

def base_tip(v, st, shots_dir):
    """Кадр «Разбора» без субтитра: скриншот или схема. Возвращает (картинка, нижний край содержимого)."""
    im, d = ms.base({'badge': BADGE['tip']})
    top = header(d, topic(v)) + 30
    if st.get('shot'):
        sh = Image.open(shots_dir / st['shot']).convert('RGB')
        y0, y1 = st.get('crop', [0, 1250])
        sh = sh.crop((0, y0, sh.size[0], y1))
        k = 940 / sh.size[0]; sh = sh.resize((940, round(sh.size[1] * k)), Image.LANCZOS)
        hmax = SUB_TOP - 40 - top
        if sh.size[1] > hmax: sh = sh.crop((0, 0, 940, hmax))
        mask = Image.new('L', sh.size, 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, *sh.size], 34, fill=255)
        im.paste(sh, (70, top), mask)
        bottom = top + sh.size[1]
    elif st.get('card'):
        bottom = scheme(im, d, st['card'], top + 20, SUB_TOP - 60)
    else: bottom = top
    if st.get('kk'):   # казахское слово крупно над субтитром
        d.text((W / 2, SUB_TOP - 90), st['kk'], font=fit(d, st['kk'], 'Arial Bold.ttf', 110, W - 160), fill=ms.GOLD, anchor='mm')
    return im, bottom

def draw_tip(im, st, shown):
    end = subtitle(ImageDraw.Draw(im), st.get('text') or st['say'], shown=shown)
    return end

def base_story(v, st, last):
    im, d = ms.base({'badge': BADGE['story']})
    d.text((W - 80, 205), 'типичная ситуация', font=ms.font('Arial.ttf', 38), fill='#d8ecf1', anchor='rm')   # правило банка
    top = header(d, topic(v))
    e = emoji(st.get('emoji') or v.get('emoji') or '💬', 260 if top < 420 else 220)
    im.paste(e, (int((W - e.size[0]) / 2), int(max(470, top + 40))), e)
    if last:   # вывод: золотая плашка по размеру всего текста
        n = len(ms.wrap(d, ' '.join(ms.nodash(st.get('text') or st['say']).split()), ms.font('Arial Bold.ttf', 76), W - 180))
        d.rounded_rectangle([60, 840, W - 60, 840 + n * 96 + 70], 36, fill=ms.GOLD)
    return im

def draw_story(im, st, last, shown):
    text = ' '.join(ms.nodash(st.get('text') or st['say']).split())
    return draw_words(ImageDraw.Draw(im), text, ms.font('Arial Bold.ttf', 76), 900, 96, W - 180, ms.INK if last else ms.WHITE, shown) + 40

# ---------- слова во времени ----------
ALIGN_PY = pathlib.Path.home() / 'transcribe-env' / 'venv' / 'bin' / 'python'

def norm_w(w): return re.sub(r'[^0-9a-zа-яәғқңөұүһі]', '', w.lower().replace('ё', 'е'))

def align_batch(pairs):
    """pairs: [(mp3, озвученный текст)] — размечает те, у которых ещё нет .words.json, одним запуском Whisper."""
    todo = [{'mp3': str(p), 'text': t, 'out': str(p.with_suffix('.words.json')), 'lang': 'ru'}
            for p, t in pairs if not p.with_suffix('.words.json').exists()]
    if not todo: return
    if not ALIGN_PY.exists():
        print('нет ~/transcribe-env (faster-whisper): субтитры проявятся равномерно по длине фразы'); return
    lst = TTS_CACHE / 'align-todo.json'; lst.write_text(json.dumps(todo, ensure_ascii=False))
    subprocess.run([str(ALIGN_PY), str(pathlib.Path(__file__).with_name('align.py')), str(lst)], check=True)

def word_starts(mp3, say, text, dur):
    """Когда показать каждое слово субтитра (секунды от начала озвучки). Если субтитр совпадает с голосом —
    по разметке Whisper; если отличается (казахское название на экране) или разметки нет — по длине слов."""
    disp = ' '.join(ms.nodash(text).split()).split(' ')
    wf = mp3.with_suffix('.words.json')
    ww = json.loads(wf.read_text()) if wf.exists() else []
    starts = [None] * len(disp)
    if ww and [norm_w(x) for x in disp] == [norm_w(x) for x in ' '.join(ms.nodash(say).split()).split(' ')]:
        sm = difflib.SequenceMatcher(None, [norm_w(x) for x in disp], [norm_w(x[0]) for x in ww], autojunk=False)
        for a, b, n in sm.get_matching_blocks():
            for j in range(n): starts[a + j] = ww[b + j][1]
    t0 = ww[0][1] if ww else 0.0
    t1 = ww[-1][2] if ww else dur
    # пропуски — по доле символов между известными соседями
    cum = [0]
    for w in disp: cum.append(cum[-1] + len(w) + 1)
    known = [(-1, t0, 0)] + [(i, starts[i], cum[i]) for i in range(len(disp)) if starts[i] is not None] + [(len(disp), t1, cum[-1])]
    for (ia, ta, ca), (ib, tb, cb) in zip(known, known[1:]):
        for i in range(max(ia, 0) if ia >= 0 else 0, ib):
            if starts[i] is None: starts[i] = ta + (tb - ta) * (cum[i] - ca) / max(cb - ca, 1)
    for i in range(1, len(starts)): starts[i] = max(starts[i], starts[i - 1])   # не раньше предыдущего слова
    return starts

def reveal(base, draw, starts, dur, tmp, name, seg, audio, key, lead=LEAD):
    """Кадры одного шага: по картинке на каждое новое слово. Голос стартует через lead после начала шага."""
    n = len(starts)
    marks = [0.0] + [s + lead for s in starts[1:]] + [dur]
    bottom = 0
    for k in range(1, n + 1):
        im = base.copy(); bottom = draw(im, k)
        p = tmp / ('%s-%03d.png' % (name, k)); im.save(p, compress_level=1)
        seg(p, max(marks[k] - marks[k - 1], 1 / 30), audio if k == 1 else None, key=key and k == n)
    return bottom

# ---------- сборка ----------
# Фоновая музыка (решение владельца 14.10.2026): казахские мотивы, тихо, голос всегда слышно. Трек и лицензия —
# соцсети/музыка/ИСТОЧНИКИ.txt. Ролики 1–14 очереди одобрены без музыки и не пересобираются.
MUSIC = ms.ROOT.parent / 'соцсети' / 'музыка' / 'atlas-kazakhstan.mp3'
MUSIC_GAIN = -18      # дБ: в паузах музыка примерно на 13 дБ тише голоса
MUSIC_STARTS = [0, 20, 40, 60, 80, 100]   # с какой секунды трека начинать — по ролику, чтобы подряд не звучали одинаково

def assemble(segs, mp4, music_start=None):
    """segs: [(png, длительность, mp3 или None)]; голос стартует вместе со своим кадром (+LEAD, у первого кадра сразу).
    music_start — секунда трека, с которой идёт фон; None — без музыки. Под речью музыка приглушается сильнее
    (sidechaincompress по голосу), в начале плавно нарастает, в конце затухает."""
    vin, ain, delays, t = [], [], [], 0.0
    for png, dur, mp3 in segs:
        vin += ['-loop', '1', '-framerate', '30', '-t', '%.3f' % dur, '-i', str(png)]
        if mp3: ain.append(mp3); delays.append(int((t + (LEAD if t else 0)) * 1000))
        t += dur
    n = len(segs)
    graph = ''.join('[%d:v]' % i for i in range(n)) + 'concat=n=%d:v=1:a=0[v];' % n
    graph += ''.join('[%d:a]adelay=%d|%d[a%d];' % (n + i, ms_, ms_, i) for i, ms_ in enumerate(delays))
    # громкость как в make_short: ровное усиление и ограничитель, без loudnorm (решение владельца 10.10.2026)
    vox = ''.join('[a%d]' % i for i in range(len(ain))) + 'amix=inputs=%d:normalize=0,volume=9dB,apad' % len(ain)
    extra = []
    use_music = music_start is not None and MUSIC.exists()
    if use_music:
        m = n + len(ain)
        extra = ['-stream_loop', '-1', '-ss', str(music_start), '-i', str(MUSIC)]
        graph += vox + ',asplit=2[vx][sc];'
        graph += ('[%d:a]aformat=sample_rates=24000:channel_layouts=mono,volume=%ddB,afade=t=in:d=0.8,'
                  'afade=t=out:st=%.2f:d=1.5[mu];' % (m, MUSIC_GAIN, max(t - 1.5, 0)))
        graph += '[mu][sc]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400[mud];'
        graph += '[vx][mud]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89:level=false[aud]'
    else:
        graph += vox + ',alimiter=limit=0.89:level=false[aud]'
    # потоки фильтров ограничены отдельно от кодировщика: иначе склейка кадров занимала 3+ ядра и грела ноутбук
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-filter_complex_threads', '1', '-threads', '1'] + vin + sum((['-i', str(a)] for a in ain), []) + extra + [
        '-filter_complex', graph, '-map', '[v]', '-map', '[aud]', '-t', '%.2f' % t, '-r', '30', '-c:v', 'libx264', '-threads', '2',   # 2 потока: меньше греется
        '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(mp4)]
    subprocess.run(cmd, check=True)
    return t

def build(v, out, mute):
    voice = v.get('voice') or ms.voice_for(v['id'], '')
    if v['type'] in RU_TYPES: voice = RU_VOICE[voice]
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='reel-'))
    segs, bottoms, keys = [], [], []   # keys — кадры для обзорного листа
    def seg(png, dur, mp3=None, key=False):
        segs.append((png, dur, mp3))
        if key: keys.append(png)
    # Заставки-крючка нет (решение владельца 26.10.2026): с 0,0 с на экране вопрос или казахское слово, голос сразу.
    # Поле hook в сценариях осталось: его русская строка — тема в шапке кадров (header) и первая строка подписи
    cta_a, cta_dur = tts(CTA_RU[v['cta']] if v['type'] in RU_TYPES else CTA[v['cta']]['say'], voice, mute)
    d_cta = max(2.8, cta_dur + 0.8)
    if v['type'] == 'cards':
        for i, c in enumerate(v['cards']):
            p = tmp / ('c%02d.png' % i)
            bottoms.append(('карточка %d' % (i + 1), frame_card(v, c, i + 1, len(v['cards']), p)))
            a, dur = tts(c.get('say') or c['kk'], voice, mute)
            seg(p, max(1.7, dur + 1.1), a, key=i in (0, len(v['cards']) - 1))   # после слова ~1 с: успеть прочитать и повторить за голосом
    elif v['type'] == 'quiz':
        opts = [o['t'] if isinstance(o, dict) else o for o in v['options']]
        order = list(range(len(opts))); random.Random(v['id']).shuffle(order)   # ключ не всегда на месте A
        q = {'text': v['q'].get('kk') or v['q']['ru'], 'sub': v['q']['ru'] if v['q'].get('kk') else '',
             'options': [opts[i] for i in order], 'answer': order.index(v['answer'])}
        # вопрос — первое, что видит зритель: крупнее прежних 62 px, если укладывается в три строки
        probe = ImageDraw.Draw(Image.new('RGB', (1, 1)))
        q['size'] = 80 if len(ms.wrap(probe, q['text'], ms.font('Arial Bold.ttf', 80), W - 160)) <= 3 else 62
        meta = {'badge': BADGE['quiz']}
        def fq(*a, **kw):   # кадр квиза; emoji у ролика — картинка внизу, под отсчётом (слон, стетоскоп, корзина)
            y = ms.frame_question(*a, **kw)
            if v.get('emoji'):
                im = Image.open(a[2]); e = emoji(v['emoji'], 200)
                im.paste(e, (int((W - e.size[0]) / 2), 1490), e); im.save(a[2])
            return y
        a, dur = tts(v['q']['say'], voice, mute)
        bottoms.append(('вопрос', fq(meta, q, tmp / 'q.png')))
        seg(tmp / 'q.png', max(3.0, dur + 0.7), a, key=True)
        for c in range(ms.COUNTDOWN, 0, -1):
            bottoms.append(('отсчёт', fq(meta, q, tmp / ('n%d.png' % c), count=c)))
            seg(tmp / ('n%d.png' % c), 1.0)
        note = (v['note'], '') if v.get('note') else None
        bottoms.append(('ответ', fq(meta, q, tmp / 'ans.png', reveal=True, explain=note)))
        a, dur = tts(v['say_answer'], voice, mute)
        seg(tmp / 'ans.png', max(3.0, dur + 1.2), a, key=True)
    elif v['type'] == 'poll':
        bottoms.append(('опрос', frame_poll(v, tmp / 'poll.png')))
        a, dur = tts(v['q']['say'], voice, mute)
        # время прочитать каждый вариант; вместе с призывом не короче DUR
        seg(tmp / 'poll.png', max(dur + 3.0 + 1.3 * len(v['poll']), DUR['poll'][0] + 0.2 - d_cta), a, key=True)
    elif v['type'] in RU_TYPES:
        for i, st in enumerate(v['steps']):
            last = i == len(v['steps']) - 1
            a, dur = tts(st['say'], voice, mute)
            starts = word_starts(a, st['say'], st.get('text') or st['say'], dur)
            d_step = dur + (0.8 if last else STEP_GAP)
            key = i in (0, len(v['steps']) // 2, len(v['steps']) - 1)
            lead = 0.0 if i == 0 else LEAD
            if v['type'] == 'tip':
                base, top = base_tip(v, st, out)
                b = reveal(base, lambda im, k, st=st: draw_tip(im, st, k), starts, d_step, tmp, 's%02d' % i, seg, a, key, lead)
                b = BOTTOM + 1 if top > SUB_TOP - 40 else b   # схема залезла на субтитр — ошибка вёрстки
            else:
                b = reveal(base_story(v, st, last), lambda im, k, st=st, last=last: draw_story(im, st, last, k), starts, d_step, tmp, 's%02d' % i, seg, a, key, lead)
            bottoms.append(('шаг %d' % (i + 1), b))
    bottoms.append(('призыв', frame_cta(v, tmp / 'cta.png')))
    seg(tmp / 'cta.png', d_cta, cta_a, key=True)

    mp4 = out / (v['id'] + '.mp4')
    total = assemble(segs, mp4, None if '--no-music' in sys.argv else MUSIC_STARTS[sum(map(ord, v['id'])) % len(MUSIC_STARTS)])
    problems = ['%s: текст заходит на подпись внизу (до %d px)' % (w, b) for w, b in bottoms if b > BOTTOM]
    lo, hi = DUR[v['type']]
    if not lo <= total <= hi: problems.append('длина %.1f с вне %d–%d с' % (total, lo, hi))
    write_caption(v, out)
    return total, voice, keys, problems

def captions(v):
    """Подписи {площадка: текст}: TikTok и Instagram (адрес текстом, хештеги обязательны: по ним TikTok понимает тему;
    с 21.10 ролики вышли без подписи) и копия в Telegram-канал. tiktok_week.py берёт подпись отсюда же."""
    hook = v.get('hook') or {'kk': v['q'].get('kk', ''), 'ru': v['q']['ru']}
    head = '%s / %s' % (hook['kk'], hook['ru']) if hook.get('kk') else hook['ru']
    if v['type'] == 'story': head += ' (типичная ситуация)'
    body = v.get('caption', '')
    # в самом канале звать в канал незачем: у роликов с призывом «Т» копия в Telegram идёт без призыва
    cta_tg = 'Полные пробные тесты: https://qazaqtrainer.com/?utm_source=telegram&utm_medium=short&utm_campaign=%s' % v['campaign'] if v['cta'] == 'S' else ''
    parts = {'tiktok': [head, body, CTA_SOCIAL[v['cta']], TAGS], 'instagram': [head, body, CTA_SOCIAL[v['cta']], TAGS], 'telegram': [head, body, cta_tg]}
    return {k: '\n\n'.join(ms.nodash(x) for x in p if x) for k, p in parts.items()}

def write_caption(v, out):
    (out / (v['id'] + '.txt')).write_text('\n\n'.join('=== %s ===\n%s' % kv for kv in captions(v).items()) + '\n')

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
    if '--mute' not in sys.argv:   # слова во времени для субтитров русских роликов: один запуск Whisper на всю пачку
        pairs = []
        for v in videos:
            if v['type'] not in RU_TYPES: continue
            voice = RU_VOICE[v.get('voice') or ms.voice_for(v['id'], '')]
            for say in [st['say'] for st in v['steps']]:
                pairs.append((tts(say, voice, False)[0], say))
        align_batch(pairs)
    rows = []
    for v in videos:
        total, voice, keys, problems = build(v, out, '--mute' in sys.argv)
        # ключевые кадры храним по роликам: пересборка одного ролика не должна стирать его соседей с обзорного листа
        kd = out / '_обзор'; kd.mkdir(exist_ok=True)
        for old in kd.glob(v['id'] + '__*.png'): old.unlink()
        for i, k in enumerate(keys): shutil.copy(k, kd / ('%s__%d.png' % (v['id'], i)))
        print('%-22s %5.1f с  %-6s %s' % (v['id'], total, voice.split('-')[2].replace('Neural', ''), '; '.join(problems) or 'ок'))
    kd = out / '_обзор'
    rows = [(v['id'], sorted(kd.glob(v['id'] + '__*.png'), key=lambda p: int(p.stem.split('__')[1])))
            for v in data['videos'] if list(kd.glob(v['id'] + '__*.png'))]
    for old in out.glob('обзор-*.png'): old.unlink()
    contact_sheets(rows, out)

if __name__ == '__main__':
    main()
