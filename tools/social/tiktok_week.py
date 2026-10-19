#!/usr/bin/env python3
"""Недельный пакет для TikTok Studio: 2 ролика в день (12:00 и 19:00 по Алматы), только одобренные владельцем в боте.

Запуск: python3 tools/social/tiktok_week.py [YYYY-MM-DD — первый день, по умолчанию завтра] [--per-day=2]
Результат: соцсети/tiktok/<первый день>/  — «01 Ср 15.10 12-00.mp4» … и подписи.txt (время + подпись к каждому).
TikTok через API без аудита публикует только приватно, поэтому владелец сам ставит пакет в планировщик TikTok Studio
на компьютере (до ~10 дней вперёд; аккаунт «Автор» или «Бизнес»). Выданные в пакет ролики пишутся в
соцсети/tiktok/выложено.json — следующий пакет начнётся с нового. Одобрение — из D1 (tg_videos, approved/published)."""
import datetime, json, pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOC = ROOT.parent / 'соцсети'
TT = SOC / 'tiktok'
DONE = TT / 'выложено.json'
TIMES = ['12-00', '19-00', '09-00', '16-00']
WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

def approved():
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'qazaq-trainer-stats', '--remote', '--config', 'wrangler.toml', '--json',
                          '--command', "SELECT n FROM tg_videos WHERE status IN ('approved','published') ORDER BY n"],
                         cwd=ROOT / 'tools' / 'events-worker', capture_output=True, text=True, check=True).stdout
    return [r['n'] for r in json.loads(out)[0]['results']]

def tiktok_caption(txt):
    return txt.split('=== tiktok ===', 1)[1].split('=== instagram ===', 1)[0].strip()

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    per_day = int(dict(a[2:].split('=') for a in sys.argv[1:] if a.startswith('--')).get('per-day', 2))
    start = datetime.date.fromisoformat(args[0]) if args else datetime.date.today() + datetime.timedelta(days=1)
    queue = {x['n']: x for x in json.loads((SOC / '_publish' / 'queue.json').read_text())}
    done = set(json.loads(DONE.read_text())) if DONE.exists() else set()
    todo = [n for n in approved() if n not in done][:7 * per_day]
    if not todo: sys.exit('новых одобренных роликов нет: одобрите в боте и запустите снова')
    out = TT / start.isoformat(); out.mkdir(parents=True, exist_ok=True)
    lines = ['TikTok Studio → Загрузить → файл → подпись ниже → «Запланировать» → дата и время (по Алматы).', '']
    for i, n in enumerate(todo):
        day = start + datetime.timedelta(days=i // per_day); t = TIMES[i % per_day]
        name = '%02d %s %s %s.mp4' % (i + 1, WD[day.weekday()], day.strftime('%d.%m'), t)
        shutil.copy2(SOC / '_publish' / queue[n]['file'], out / name)
        week = next(SOC.glob('неделя-*/%s.txt' % queue[n]['id']))
        lines += ['=== %s · %s %s %s · ролик %d (%s)' % (name[:2], WD[day.weekday()], day.strftime('%d.%m'), t.replace('-', ':'), n, queue[n]['id']),
                  tiktok_caption(week.read_text()), '']
    (out / 'подписи.txt').write_text('\n'.join(lines))
    DONE.write_text(json.dumps(sorted(done | set(todo))))
    print('%d роликов на %d дней → %s' % (len(todo), -(-len(todo) // per_day), out))

if __name__ == '__main__':
    main()
