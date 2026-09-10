#!/usr/bin/env python3
"""Вставляет казахские переводы вводных, пояснений, подсказок, критериев и чек-листов в src/data/tests/*.js.
Источник переводов — tools/tests_kk/*.json (ключ = русская строка как в файле теста). Идемпотентен: старые *_kk убираются и ставятся заново.
Поля: intro, explain, hint, top, targetNote, checkNote, label, title, note (только подписи к картинке) (комплекты «Комплект N — …») → <поле>_kk; checklist → checklist_kk.
Запуск: python3 tools/apply_tests_kk.py [--report]"""
import re, json, glob, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
D = ROOT / 'tools' / 'tests_kk'
maps = {}
for k in ('intro', 'explain', 'hint'):
    maps[k] = json.load(open(D / f'{k}.json', encoding='utf-8'))
misc = json.load(open(D / 'misc.json', encoding='utf-8'))
for k in ('top', 'targetNote', 'checkNote', 'label', 'title'):
    maps[k] = misc[k]
CHECK = misc['checklist']
extra = json.load(open(D / 'extra.json', encoding='utf-8'))   # добор: пояснения, подсказки, подписи к картинке (note), чек-листы
for k, v in extra.items():
    if k == 'checklist': CHECK.update(v)
    else: maps.setdefault(k, {}).update(v)
SCALAR = list(maps.keys())
KK = re.compile(r'[әғқңөұүіһӘҒҚҢӨҰҮІҺ]'); W = re.compile(r'[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүІіҺһ]{2,}')
RUW = set('и в на не по что это для как из с к а но или при от до за о об у же бы только после перед здесь текст слов минут вопрос ответ задания задание уровня уровень время если ваш ваша ваше все всё есть нет один одна одно два три без тема темы кто где когда почему через между'.split())
def needs(v):
    ws = W.findall(v)
    if not ws: return False
    kk = sum(1 for w in ws if KK.search(w)); ru = sum(1 for w in ws if w.lower() in RUW or re.search(r'(ый|ий|ого|его|ому|ему|ться|тся|ать|ять|ние|ция|ции|ых|ами|ями|ешь|ете|ите|ой)$', w.lower()))
    return ru >= 1 and kk / len(ws) < 0.5
def unesc(s): return s.replace("\\'", "'")
def esc(s): return s.replace("\\", "\\\\").replace("'", "\\'")
missing = {}
def set_title(ru):
    m = re.match(r'Комплект (\d+) — (.+?)( \(дополнительный\))?$', ru)
    if m: return f"{m.group(1)}-жинақ — {m.group(2)}" + (' (қосымша)' if m.group(3) else '')
    return maps['title'].get(ru)
for f in sorted(glob.glob(str(ROOT / 'src/data/tests/*.js'))):
    s = open(f, encoding='utf-8').read(); orig = s
    # снять старые вставки
    s = re.sub(r", (?:%s)_kk: '(?:[^'\\]|\\.)*'" % '|'.join(SCALAR), '', s)
    s = re.sub(r",\s*checklist_kk: \[[^\]]*\]", '', s)
    def rep(m):
        key, raw = m.group(1), m.group(2); ru = unesc(raw)
        kk = set_title(ru) if key == 'title' else maps[key].get(ru)
        if kk is None:
            if needs(ru) and not (key == 'title' and not ru.startswith('Комплект')) and not (key == 'note' and not re.match(r'В реальном тесте|На [ABC][12]', ru)): missing.setdefault(key, set()).add(ru)  # note раздела в интерфейс не выводится
            return m.group(0)
        return m.group(0) + f", {key}_kk: '{esc(kk)}'"
    s = re.sub(r"\b(%s): '((?:[^'\\]|\\.)*)'" % '|'.join(SCALAR), rep, s)
    def repl(m):
        items = re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))
        out = []
        for it in items:
            ru = unesc(it); kk = CHECK.get(ru)
            if kk is None:
                if needs(ru): missing.setdefault('checklist', set()).add(ru)
                kk = ru
            out.append("'" + esc(kk) + "'")
        return m.group(0) + ', checklist_kk: [' + ', '.join(out) + ']'
    s = re.sub(r"checklist: \[((?:\s*'(?:[^'\\]|\\.)*',?\s*)+)\]", repl, s)
    if s != orig: open(f, 'w', encoding='utf-8').write(s)
    print(f.split('/')[-1], 'kk fields:', len(re.findall(r'_kk: ', s)), file=sys.stderr)
if missing:
    print('НЕТ ПЕРЕВОДА:', {k: len(v) for k, v in missing.items()}, file=sys.stderr)
    if '--report' in sys.argv:
        for k, v in missing.items():
            for x in sorted(v): print(f'  [{k}] {x}', file=sys.stderr)
