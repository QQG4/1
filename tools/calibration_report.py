#!/usr/bin/env python3
"""Измеритель калибровки тестов: показывает подсказки, по которым вопрос угадывается без чтения текста.

    python3 tools/calibration_report.py            # все тесты
    python3 tools/calibration_report.py qrt-c1     # только совпадающие по имени

Три сигнала (пороги взяты с переработанных qrt-b2-01 и kaztest-b2-01/02):
  «ключ заметно длиннее» — норма до 30 %; при 70 %+ тест сдаётся выбором длинного варианта.
  Считается только случай, когда ключ строго длиннее всех и минимум на 10 % длиннее второго по длине:
  ничья по длине подсказкой не является, а разница в один-два знака на экране не видна.
  «дистрактор есть в тексте» — норма от 45 %; если дистракторов в тексте нет, лишние варианты отсеиваются на глаз.
  Считается только по аудированию и чтению: у лексико-грамматических заданий (id x*, g*) дистрактор — это слово
  или форма, которой в тексте и не должно быть, мерить их этим правилом бессмысленно;
  «tf: доля Бұрыс» — норма 40–60 %; перекос делает угадывание выгодным.
"""
import re, glob, sys, os

def parse(path):
    s = open(path, encoding='utf-8').read()
    tid = re.search(r"id:\s*'([^']+)'", s).group(1)
    lvl = re.search(r"level:\s*'([^']+)'", s).group(1)
    corpus = ' '.join(re.findall(r"text:\s*'((?:[^'\\]|\\.)*)'", s)) + ' ' + ' '.join(re.findall(r"paragraphs:\s*\[(.*?)\]", s, re.S))
    qs = []
    for m in re.finditer(r"\{[^{}]*?id:\s*'([^']+)'[^{}]*?options:\s*\[(.*?)\][^{}]*?answer:\s*(\d+)", s, re.S):
        opts = [o[1:-1] for o in re.findall(r"'(?:[^'\\]|\\.)*'", m.group(2))]
        qs.append((m.group(1), opts, int(m.group(3))))
    tf = re.findall(r"kind:\s*'tf'[^}]*?answer:\s*(\d+)", s, re.S)
    return tid, lvl, corpus, qs, [int(x) for x in tf]

def report(paths):
    rows = []
    for f in paths:
        tid, lvl, corpus, qs, tf = parse(f)
        if not qs: continue
        def giveaway(o, a):
            L = sorted((len(x) for i, x in enumerate(o) if i != a), reverse=True)
            return len(o[a]) > L[0] * 1.1
        longest = sum(1 for _, o, a in qs if giveaway(o, a))
        din = dtot = 0
        worst = []
        for qid, o, a in qs:
            for j, x in enumerate(o):
                if j == a or qid[0] in 'xg': continue   # лексика-грамматика вне этой метрики
                dtot += 1
                w = [t for t in re.findall(r'\w+', x) if len(t) > 5]
                if w and any(t in corpus for t in w): din += 1
            if giveaway(o, a): worst.append(qid)
        rows.append((tid, lvl, len(qs), 100 * longest // len(qs), 100 * din // max(dtot, 1),
                     (100 * sum(tf) // len(tf)) if tf else None, len(tf), worst))
    print(f"{'тест':<16}{'ур':<4}{'вопр':>5}{'ключ длиннее':>14}{'дистр. в тексте':>17}{'tf Бұрыс':>10}")
    for tid, lvl, n, lg, di, tfp, tfn, worst in rows:
        flag = lambda ok: '' if ok else '  ←'
        print(f"{tid:<16}{lvl:<4}{n:>5}{str(lg)+' %':>14}{flag(lg<=30)}{str(di)+' %':>17}{flag(di>=45)}"
              + (f"{str(tfp)+' %':>10}{flag(40<=tfp<=60)}" if tfp is not None else f"{'—':>10}"))
        if worst: print(f"{'':<20}заметно длиннее остальных: {', '.join(worst)}")

pat = sys.argv[1] if len(sys.argv) > 1 else ''
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'data', 'tests')
report(sorted(f for f in glob.glob(os.path.join(root, '*.js')) if pat in os.path.basename(f)))
