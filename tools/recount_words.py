#!/usr/bin/env python3
"""Пересчитывает поле words у скриптов аудирования и текстов чтения по фактическому тексту (слово = последовательность
кириллических букв, дефисные слова считаются одним). Запуск из qazaq-trainer: python3 tools/recount_words.py [--check]"""
import re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
W = re.compile(r"[А-Яа-яӘәҒғҚқҢңӨөҰұҮүІіҺһЁё]+(?:-[А-Яа-яӘәҒғҚқҢңӨөҰұҮүІіҺһЁё]+)?")
check = '--check' in sys.argv; changed = 0
for f in sorted((ROOT / 'src/data/tests').glob('*.js')):
    s = f.read_text(encoding='utf-8'); orig = s
    def fix_script(m):
        n = len(W.findall(m.group(2).replace('\\n', ' '))); return m.group(0)[:m.start(3) - m.start(0)] + str(n) + m.group(0)[m.end(3) - m.start(0):]
    s = re.sub(r"(script: \{\s*title: '(?:[^'\\]|\\.)*',\s*text: ')((?:[^'\\]|\\.)*)(?:',\s*words: )(\d+)", lambda m: m.group(0)[:-len(m.group(3))] + str(len(W.findall(m.group(2).replace('\\n', ' ')))), s)
    def fix_passage(m):
        t = ' '.join(re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))); n = len(W.findall(t)); return m.group(0)[:-len(m.group(2))] + str(n)
    s = re.sub(r"paragraphs: \[([\s\S]*?)\],\s*words: (\d+)", fix_passage, s)
    if s != orig:
        changed += 1
        if not check: f.write_text(s, encoding='utf-8')
        for a, b in zip(re.findall(r"words: (\d+)", orig), re.findall(r"words: (\d+)", s)):
            if a != b: print(f"{f.stem:14} {a:>4} → {b}")
print('файлов изменено:', changed, '(проверка)' if check else '')
