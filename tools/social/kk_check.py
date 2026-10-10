#!/usr/bin/env python3
"""Проверка казахского правописания в роликах по нашему корпусу: книги (книги/очищенное, ~25 млн слов) и тесты.

Правописание в роликах — самое чувствительное место (решение владельца 10.10.2026), поэтому каждое казахское
слово сверяется с корпусом, а каждая фраза из двух и более слов ищется в нём целиком. Носителя это не заменяет:
грамматику (окончания, согласование) частота подтверждает только косвенно.

  python3 tools/social/kk_check.py --build          собрать кэш (раз, ~2 мин) в соцсети/_kk/
  python3 tools/social/kk_check.py слово «фраза»…   проверить строки из командной строки

Что ловит:
  RARE   словоформа встречается в корпусе реже MIN_FREQ раз — опечатка или редкая форма, проверить;
  SWAP   есть вариант с казахской буквой вместо русской (уй → үй) или наоборот, и он заметно частотнее;
  PAIR   пары соседних слов нет в корпусе — не обязательно ошибка (книги не говорят о Телеграме), но такую
         пару носитель смотрит первой.
Подтверждённые формы — kk_allow.txt рядом: «слово<TAB>кто подтвердил: почему». Они не дают RARE и SWAP,
но в список для носителя всё равно попадают, пока там не написано «носитель»."""
import collections, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = ROOT.parent / 'соцсети' / '_kk'
FREQ, CORPUS = CACHE / 'freq.tsv', CACHE / 'corpus.txt'
MIN_FREQ = 3
WORD = re.compile(r'[а-яёәғқңөұүһі]+(?:-[а-яёәғқңөұүһі]+)*')
# пары «русская буква ↔ казахская», которые путают при наборе
PAIRS = {'а': 'ә', 'г': 'ғ', 'к': 'қ', 'н': 'ң', 'о': 'ө', 'у': 'үұ', 'и': 'і', 'х': 'һ'}
BACK = {k: r for r, ks in PAIRS.items() for k in ks}

def norm(t):
    return re.sub(r'\s+', ' ', t.lower().replace('ё', 'е')).strip()

def build():
    CACHE.mkdir(parents=True, exist_ok=True)
    files = sorted((ROOT.parent / 'книги' / 'очищенное').rglob('*.md')) + sorted((ROOT / 'src' / 'data' / 'tests').glob('*.js'))
    freq = collections.Counter()
    with CORPUS.open('w') as out:
        for f in files:
            for line in f.read_text(errors='ignore').splitlines():
                line = norm(line)
                if re.search('[әғқңөұүһі]', line):   # только строки с казахскими буквами: русский текст не нужен
                    out.write(line + '\n'); freq.update(WORD.findall(line))
    with FREQ.open('w') as out:
        for w, n in freq.most_common():
            if n >= 2: out.write('%s\t%d\n' % (w, n))
    print('%d файлов, %d словоформ, %s' % (len(files), len(freq), CACHE))

_freq = None
def freq(w):
    global _freq
    if _freq is None:
        if not FREQ.exists(): sys.exit('нет кэша, сначала: python3 tools/social/kk_check.py --build')
        _freq = {}
        for line in FREQ.open():
            k, n = line.rstrip('\n').split('\t'); _freq[k] = int(n)
    return _freq.get(w, 0)

def variants(w):
    """Все слова, отличающиеся одной заменой в паре «русская ↔ казахская буква»."""
    for i, ch in enumerate(w):
        for alt in PAIRS.get(ch, '') + BACK.get(ch, ''):
            yield w[:i] + alt + w[i + 1:]

def pair_counts(pairs):
    """Сколько раз каждая пара слов встречается в корпусе. Один проход grep на все новые пары, ответы — в кэш
    pairs.json (по grep на пару проверка недели шла больше двух минут). Совпадение по началу слова: «бір тест»
    засчитывается и в «бір тесттен» — для подсказки носителю этого достаточно."""
    import json
    cache_f = CACHE / 'pairs.json'
    cache = json.loads(cache_f.read_text()) if cache_f.exists() else {}
    new = sorted(set(pairs) - set(cache))
    if new:
        pats = CACHE / 'pats.txt'; pats.write_text('\n'.join(new) + '\n')
        out = subprocess.run('grep -o -F -f "%s" "%s" | sort | uniq -c' % (pats, CORPUS), shell=True, capture_output=True, text=True).stdout
        found = {}
        for line in out.splitlines():
            n, p = line.strip().split(' ', 1); found[p] = int(n)
        for p in new: cache[p] = found.get(p, 0)
        cache_f.write_text(json.dumps(cache, ensure_ascii=False))
    return {p: cache[p] for p in pairs}

ALLOW = {}
for line in (pathlib.Path(__file__).with_name('kk_allow.txt').read_text().splitlines() if pathlib.Path(__file__).with_name('kk_allow.txt').exists() else []):
    if '\t' in line and not line.startswith('#'): k, v = line.split('\t', 1); ALLOW[k.strip()] = v.strip()

def check(texts):
    """texts: список казахских строк. Возвращает список (вид, строка, слово/фраза, подробность)."""
    issues, seen, todo = [], set(), []
    for t in texts:
        t = norm(t)
        words = WORD.findall(t)
        for w in words:
            if w in seen or w in ALLOW: continue
            seen.add(w)
            n = freq(w)
            best = max(((freq(v), v) for v in variants(w)), default=(0, ''))
            if best[0] > max(10, n * 5):
                issues.append(('SWAP', t, w, 'в корпусе %d, а «%s» %d' % (n, best[1], best[0])))
            elif n < MIN_FREQ:
                issues.append(('RARE', t, w, 'в корпусе %d' % n))
        # пары берём только внутри куска без знаков препинания: «күн, күніне» — не пара
        pairs = [(a, b) for chunk in re.split(r'[,.;:!?«»"()]+', t) for ws in [WORD.findall(chunk)] for a, b in zip(ws, ws[1:])]
        for a, b in pairs:
            p = a + ' ' + b
            if p in seen or p in ALLOW: continue
            seen.add(p); todo.append((t, p))
    counts = pair_counts([p for _, p in todo])
    issues += [('PAIR', t, p, 'пары в корпусе нет') for t, p in todo if counts[p] == 0]
    return issues

def report(issues):
    for kind, t, w, info in issues: print('%-6s %-28s %s   [%s]' % (kind, w, info, t))
    return issues

if __name__ == '__main__':
    if '--build' in sys.argv: build()
    elif len(sys.argv) > 1: report(check(sys.argv[1:])) or print('замечаний нет')
    else: sys.exit(__doc__)
