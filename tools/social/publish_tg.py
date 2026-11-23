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
            # новые сборки важнее старой сборки недели: новый вид сайта (31.10.2026), затем формат без заставки (26.10.2026)
            for folder in ('новый-вид', 'tiktok-полигон'):
                new = ROOT / folder / (v['id'] + '.mp4')
                if new.exists(): mp4 = new; break
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
    # Вне банка (19.11.2026): ролики прогрева конкурса эссе. Номера с 1001, чтобы номера банка не сдвигались;
    # воркер выпускает номера от 1000 раньше остальных одобренных (videos.js, ig.js).
    # Серия «по-казахски за 15 секунд» (23.11.2026, по аналитике роликов): номера с 1101, выходит раньше банка, после прогрева.
    for k, (folder, start) in enumerate([('прогрев-письмо/ролики', 1001), ('по-казахски', 1101)]):
        scen = ROOT / folder / 'сценарии.json'
        if not scen.exists(): continue
        for i, v in enumerate(json.loads(scen.read_text())['videos']):
            mp4 = ROOT / folder / (v['id'] + '.mp4')
            if not mp4.exists(): continue
            name = 'v/%04d.mp4' % (start + i)
            shutil.copy2(mp4, OUT / name)
            queue.append({'n': start + i, 'id': v['id'], 'slot': v['slot'], 'date': v['date'], 'file': name,
                          'caption': tg_caption(mp4.with_suffix('.txt').read_text()),
                          'caption_ig': ig_caption(mp4.with_suffix('.txt').read_text())})
    (OUT / 'queue.json').write_text(json.dumps(queue, ensure_ascii=False, indent=1))
    print('%d роликов → %s' % (len(queue), OUT))

if __name__ == '__main__':
    main()
