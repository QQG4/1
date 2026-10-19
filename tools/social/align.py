#!/usr/bin/env python3
"""Время каждого слова в озвучке — для субтитров, которые появляются по слову (reels.py, решение владельца 12.10.2026).

Запускается из venv расшифровки (там faster-whisper): ~/transcribe-env/venv/bin/python tools/social/align.py <список.json>
Список: [{"mp3": путь, "text": что озвучено, "out": куда писать, "lang": "ru"}]. На выходе для каждого mp3 —
JSON [[слово, начало, конец], …]. Модель large-v3-turbo уже в кэше huggingface; текст фразы идёт подсказкой,
поэтому слова распознаются так, как они написаны в сценарии."""
import json, sys
from faster_whisper import WhisperModel

items = json.load(open(sys.argv[1]))
# cpu_threads=2: на всех ядрах ноутбук сильно грелся (12.10.2026); медленнее, но терпимо
model = WhisperModel('mobiuslabsgmbh/faster-whisper-large-v3-turbo', device='cpu', compute_type='int8', cpu_threads=2)
for it in items:
    segs, _ = model.transcribe(it['mp3'], language=it.get('lang', 'ru'), word_timestamps=True, initial_prompt=it['text'])
    words = [[w.word.strip(), round(w.start, 3), round(w.end, 3)] for s in segs for w in s.words]
    json.dump(words, open(it['out'], 'w'), ensure_ascii=False)
print('размечено фраз: %d' % len(items))
