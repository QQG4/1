#!/usr/bin/env python3
"""Пробная озвучка одного теста другими движками, для сравнения с Azure (в сборку не попадает, пишет audio/<id>-<engine>.mp3).
Ключи ТОЛЬКО в ~/.config/qazaq-trainer/<engine>.env:
  openai.env : OPENAI_API_KEY=...            (модель gpt-4o-mini-tts, голос и стиль задаются инструкцией)
  yandex.env : YANDEX_API_KEY=...            (SpeechKit v1, голоса kk-KZ: amira (жен.), madi (муж.))
Запуск из папки qazaq-trainer: python3 tools/tts_trial.py <engine> <testId> [--voice=...] [--instructions="..."] [--speed=0.9]
"""
import os, sys, json, pathlib, urllib.request, urllib.parse
sys.path.insert(0, str(pathlib.Path(__file__).parent))
ROOT = pathlib.Path(__file__).resolve().parent.parent
engine, tid = sys.argv[1], sys.argv[2]
OPTS = {a.split('=')[0][2:]: a.split('=', 1)[1] for a in sys.argv[3:] if a.startswith('--')}
env_path = pathlib.Path(os.path.expanduser(f'~/.config/qazaq-trainer/{engine}.env'))
if not env_path.exists(): sys.exit(f'нет ключа: создайте {env_path} (см. докстринг)')
env = dict(l.strip().split('=', 1) for l in env_path.read_text().splitlines() if '=' in l and not l.startswith('#'))

# текст скрипта из данных теста (тот же парсер, что в tts_azure.py)
import re
src = (ROOT / 'src/data/tests' / f'{tid}.js').read_text(encoding='utf-8')
m = re.search(r"type: 'listening',[\s\S]*?script: \{\s*title: '((?:[^'\\]|\\.)*)',\s*text: '((?:[^'\\]|\\.)*)'", src)
text = m.group(2).replace('\\n', '\n').replace("\\'", "'")
plain = re.sub(r'^—\s*', '', text, flags=re.M)

if engine == 'openai':
    voice = OPTS.get('voice', 'onyx')   # мужские: onyx, echo; женские: nova, shimmer, coral
    instr = OPTS.get('instructions', 'Оқы қазақ тілінде, табиғи, жылы интонациямен, мұғалім сияқты, асықпай; сөйлемдерді біртұтас оқы, әр сөйлем соңында қысқа кідіріс.')
    body = json.dumps({'model': 'gpt-4o-mini-tts', 'input': plain, 'voice': voice, 'instructions': instr, 'response_format': 'mp3', 'speed': float(OPTS.get('speed', '1.0'))}).encode()
    req = urllib.request.Request('https://api.openai.com/v1/audio/speech', data=body, headers={'Authorization': 'Bearer ' + env['OPENAI_API_KEY'], 'Content-Type': 'application/json'})
    data = urllib.request.urlopen(req, timeout=180).read()
elif engine == 'yandex':
    voice = OPTS.get('voice', 'madi')   # madi (муж.), amira (жен.)
    params = {'text': plain[:5000], 'lang': 'kk-KZ', 'voice': voice, 'speed': OPTS.get('speed', '1.0'), 'format': 'mp3'}
    req = urllib.request.Request('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize', data=urllib.parse.urlencode(params).encode(), headers={'Authorization': 'Api-Key ' + env['YANDEX_API_KEY']})
    data = urllib.request.urlopen(req, timeout=180).read()
else:
    sys.exit('engine: openai | yandex')
out = ROOT / 'audio' / f'{tid}-{engine}.mp3'
out.write_bytes(data); print('записано', out, len(data) // 1024, 'KB')
