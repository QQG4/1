#!/usr/bin/env python3
"""Папка публикации роликов для воркера канала: соцсети/_publish/ (v/NNN.mp4 + queue.json).

Запуск: python3 tools/social/publish_tg.py   → затем деплой воркера (tools/events-worker, README).
Воркер раздаёт эту папку как статические файлы и по одному ролику в день спрашивает владельца в боте:
«Публиковать / Пропустить / Поменять» (решение владельца 13.10.2026). Порядок — по банку подряд: день, затем слот
(Разбор, Язык, История, Проверь себя), поэтому слоты в канале чередуются. Номер n — позиция в этом порядке; он
стабилен, пока не добавляются ролики в середину. Пересобранный ролик (правка) — перезапустить скрипт и задеплоить.
Подпись — блок «telegram» из <id>.txt без ссылки на сайт: в канале ссылка только в вечернем посте (правило владельца)."""
import json, pathlib, shutil

ROOT = pathlib.Path(__file__).resolve().parents[2].parent / 'соцсети'
OUT = ROOT / '_publish'

def tg_caption(txt):
    block = txt.split('=== telegram ===', 1)[1].strip()
    lines = [l for l in block.splitlines() if 'qazaqtrainer.com' not in l and 'http' not in l]
    return '\n'.join(lines).strip()

def ig_caption(txt):
    """Подпись для Instagram — блок «instagram» из <id>.txt (адрес сайта текстом и хэштеги)."""
    return txt.split('=== instagram ===', 1)[1].split('=== telegram ===', 1)[0].strip()

def main():
    items = []
    for week in sorted(ROOT.glob('неделя-*/сценарии.json')):
        data = json.loads(week.read_text())
        for v in data['videos']:
            mp4 = week.parent / (v['id'] + '.mp4')
            new = ROOT / 'tiktok-полигон' / (v['id'] + '.mp4')   # новый формат (26.10.2026) важнее старой сборки недели
            if new.exists(): mp4 = new
            if mp4.exists(): items.append((v, mp4))
    items.sort(key=lambda x: x[0]['id'])   # 1012-1-… < 1012-2-… < … < 1101-…: день, затем слот
    (OUT / 'v').mkdir(parents=True, exist_ok=True)
    queue = []
    for n, (v, mp4) in enumerate(items, 1):
        name = 'v/%03d.mp4' % n
        shutil.copy2(mp4, OUT / name)
        queue.append({'n': n, 'id': v['id'], 'slot': v['slot'], 'date': v['date'], 'file': name,
                      'caption': tg_caption(mp4.with_suffix('.txt').read_text()),
                      'caption_ig': ig_caption(mp4.with_suffix('.txt').read_text())})
    (OUT / 'queue.json').write_text(json.dumps(queue, ensure_ascii=False, indent=1))
    print('%d роликов → %s' % (len(queue), OUT))

if __name__ == '__main__':
    main()
