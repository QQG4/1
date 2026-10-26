#!/usr/bin/env python3
"""Пакет для TikTok Studio: по ролику в день в 19:00 по Алматы (решение владельца 26.10.2026: TikTok — полигон, две
недели по ролику в день), только одобренные владельцем в боте.

Запуск: python3 tools/social/tiktok_week.py [YYYY-MM-DD — первый день, по умолчанию завтра] [--per-day=1] [--days=7] [--from=N]
  --from=N  ролики очереди с номера N без одобрения в боте (новый шаблон 26.10.2026 владелец одобрил по пробным,
            а в боте одобрены только старые №1–24)
  --src=DIR ролики из соцсети/DIR (например tiktok-полигон: 14 роликов по новому шаблону), а не из папок недель
Результат: соцсети/tiktok/<первый день>/  — «01 Ср 15.10 19-00.mp4» и рядом «01 Ср 15.10 19-00.txt» с подписью
к этому файлу; подписи.txt — все подписи подряд с теми же номерами. С 21.10 ролики вышли в TikTok без подписей и
хештегов, поэтому подпись лежит рядом с каждым файлом под тем же именем, а пакет без хештегов не собирается.
Подпись строится из сценария (reels.captions) по текущим правилам, а не из старого <id>.txt.
TikTok через API без аудита публикует только приватно, поэтому владелец сам ставит пакет в планировщик TikTok Studio
на компьютере (до ~10 дней вперёд; аккаунт «Автор» или «Бизнес»). Выданные в пакет ролики пишутся в
соцсети/tiktok/выложено.json — следующий пакет начнётся с нового. Одобрение — из D1 (tg_videos, approved/published)."""
import datetime, json, pathlib, shutil, subprocess, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import reels

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOC = ROOT.parent / 'соцсети'
TT = SOC / 'tiktok'
DONE = TT / 'выложено.json'
TIMES = {1: ['19-00'], 2: ['12-00', '19-00'], 3: ['12-00', '16-00', '19-00'], 4: ['09-00', '12-00', '16-00', '19-00']}
TAGS_NEED = ('#казахскийязык', '#қазақтілі', '#казтест', '#қазтест', '#qazresmitest')
WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

def approved():
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'qazaq-trainer-stats', '--remote', '--config', 'wrangler.toml', '--json',
                          '--command', "SELECT n FROM tg_videos WHERE status IN ('approved','published') ORDER BY n"],
                         cwd=ROOT / 'tools' / 'events-worker', capture_output=True, text=True, check=True).stdout
    return [r['n'] for r in json.loads(out)[0]['results']]

def scenario(vid):
    """Сценарий ролика по id из всех недель (кампания недели нужна подписи)."""
    for f in sorted(SOC.glob('неделя-*/сценарии.json')):
        data = json.loads(f.read_text())
        for v in data['videos']:
            if v['id'] == vid: return dict(v, campaign=data['campaign'])
    sys.exit('сценарий ролика %s не найден в соцсети/неделя-*/сценарии.json' % vid)

def tiktok_caption(vid):
    cap = reels.captions(scenario(vid))['tiktok']
    miss = [t for t in TAGS_NEED if t not in cap]
    if miss: sys.exit('%s: в подписи нет хештегов %s' % (vid, ' '.join(miss)))
    if 'в профиле' in cap: sys.exit('%s: «ссылка в профиле» в подписи: в TikTok не кликается' % vid)
    if len(cap) > 2200: sys.exit('%s: подпись длиннее 2200 знаков' % vid)
    return cap

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opt = dict(a[2:].split('=') for a in sys.argv[1:] if a.startswith('--'))
    per_day, days = int(opt.get('per-day', 1)), int(opt.get('days', 7))
    start = datetime.date.fromisoformat(args[0]) if args else datetime.date.today() + datetime.timedelta(days=1)
    queue = {x['n']: x for x in json.loads((SOC / '_publish' / 'queue.json').read_text())}
    done = set(json.loads(DONE.read_text())) if DONE.exists() else set()
    pool = sorted(n for n in queue if n >= int(opt['from'])) if 'from' in opt else approved()
    todo = [n for n in pool if n not in done][:days * per_day]
    if not todo: sys.exit('новых одобренных роликов нет: одобрите в боте и запустите снова')
    out = TT / start.isoformat(); out.mkdir(parents=True, exist_ok=True)
    lines = ['TikTok Studio → Загрузить → файл «NN … .mp4» → в поле «Описание» вставить ВСЁ из файла «NN … .txt» с тем же',
             'номером (подпись и хештеги) → «Запланировать» → дата и время из имени файла (по Алматы).',
             'Без подписи не публиковать: по хештегам TikTok понимает, кому показывать ролик.', '']
    for i, n in enumerate(todo):
        day = start + datetime.timedelta(days=i // per_day); t = TIMES[per_day][i % per_day]
        name = '%02d %s %s %s' % (i + 1, WD[day.weekday()], day.strftime('%d.%m'), t)
        cap = tiktok_caption(queue[n]['id'])
        # свежая сборка из папки недели: копия в _publish обновляется только publish_tg.py
        src = SOC / opt['src'] / (queue[n]['id'] + '.mp4') if 'src' in opt else next(SOC.glob('неделя-*/%s.mp4' % queue[n]['id']))
        if not src.exists(): sys.exit('нет файла %s' % src)
        shutil.copy2(src, out / (name + '.mp4'))
        (out / (name + '.txt')).write_text(cap + '\n')
        lines += ['=' * 60, '%s.mp4  ·  %s %s %s  ·  ролик %d (%s)' % (name, WD[day.weekday()], day.strftime('%d.%m'), t.replace('-', ':'), n, queue[n]['id']),
                  '-' * 60, cap, '']
    (out / 'подписи.txt').write_text('\n'.join(lines))
    DONE.write_text(json.dumps(sorted(done | set(todo))))
    print('%d роликов на %d дней → %s' % (len(todo), -(-len(todo) // per_day), out))

if __name__ == '__main__':
    main()
