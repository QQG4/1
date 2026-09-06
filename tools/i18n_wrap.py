#!/usr/bin/env python3
"""Оборачивает русские текстовые фрагменты в строковых литералах src/app.js и src/course.js в T('…') (ключ = русский текст).
Казахские фрагменты (буквы ә ғ қ ң ө ұ ү і һ) не трогает. Пишет список ключей в tools/i18n_keys.txt.
Идемпотентен: уже обёрнутые T('…') пропускаются."""
import re, sys, pathlib, json
ROOT = pathlib.Path(__file__).resolve().parent.parent
KK = re.compile(r'[әғқңөұүіһӘҒҚҢӨҰҮІҺ]')
RU = re.compile(r'[А-Яа-яЁё]')
REGEX_PREV = set('(,=:[!&|?{};+-*%<>~^') | {''}

def scan(js):
    """Возвращает список (start, end, quote) строковых литералов, пропуская комментарии и regex-литералы."""
    out = []; i = 0; n = len(js); prev = ''
    while i < n:
        c = js[i]
        if js.startswith('//', i):
            j = js.find('\n', i); i = n if j < 0 else j; continue
        if js.startswith('/*', i):
            j = js.find('*/', i); i = j + 2; continue
        if c in '\'"':
            j = i + 1
            while j < n and js[j] != c:
                if js[j] == '\\': j += 1
                j += 1
            out.append((i, j + 1, c)); i = j + 1; prev = c; continue
        if c == '/' and prev in REGEX_PREV:
            j = i + 1; cls = False
            while j < n:
                if js[j] == '\\': j += 2; continue
                if js[j] == '[': cls = True
                elif js[j] == ']': cls = False
                elif js[j] == '/' and not cls: break
                j += 1
            i = j + 1; prev = '/'; continue
        if not c.isspace(): prev = c
        i += 1
    return out

def wrap_literal(lit, q):
    """lit — содержимое литерала без кавычек. Возвращает новое содержимое (с ' + T(...) + ' вставками) и список ключей."""
    keys = []
    # разбить на теги и текст
    parts = re.split(r'(<[^<>]*>)', lit)
    res = []
    for part in parts:
        if part.startswith('<') and part.endswith('>'):
            res.append(part); continue
        if not RU.search(part) or KK.search(part):
            res.append(part); continue
        m = re.match(r'^([\s·:;,()\-—–]*?)(.*?)([\s·]*)$', part, re.S)
        lead, core, trail = m.group(1), m.group(2), m.group(3)
        # ведущую пунктуацию оставляем внутри, если она часть фразы (например «(верхний…)»)
        if core.startswith('(') and core.endswith(')'): pass
        # обрезаем ведущие небуквенные до первой буквы/скобки/кавычки
        mm = re.match(r'^([^\wА-Яа-яЁё«(]*)(.*)$', core, re.S)
        lead += mm.group(1); core = mm.group(2)
        if not core or not RU.search(core): res.append(part); continue
        key = core.replace("\\'", "'").replace('\\"', '"')
        keys.append(key)
        res.append(lead + q + ' + T(' + q + core + q + ') + ' + q + trail)
    return ''.join(res), keys

def process(path):
    js = path.read_text(encoding='utf-8')
    lits = scan(js)
    out = []; last = 0; allkeys = []
    for (s, e, q) in lits:
        out.append(js[last:s])
        inner = js[s + 1:e - 1]
        # пропускаем уже обёрнутые: T('...') — предыдущие символы
        if js[max(0, s - 2):s] == 'T(':
            out.append(js[s:e]); last = e; continue
        new, keys = wrap_literal(inner, q)
        allkeys += keys
        out.append(q + new + q); last = e
    out.append(js[last:])
    res = ''.join(out)
    # убрать пустые '' + / + '' конкатенации
    res = re.sub(r"'' \+ ", '', res); res = re.sub(r" \+ ''(?=[\s;,)\]])", '', res)
    res = re.sub(r'"" \+ ', '', res); res = re.sub(r' \+ ""(?=[\s;,)\]])', '', res)
    return res, allkeys

if __name__ == '__main__':
    keys = []
    for name in ('src/app.js', 'src/course.js'):
        p = ROOT / name; res, k = process(p); keys += k
        if '--write' in sys.argv: p.write_text(res, encoding='utf-8')
        print(name, 'ключей:', len(k), file=sys.stderr)
    uniq = sorted(set(keys), key=lambda x: (len(x), x))
    (ROOT / 'tools' / 'i18n_keys.txt').write_text('\n'.join(uniq), encoding='utf-8')
    print('уникальных ключей:', len(uniq), file=sys.stderr)
