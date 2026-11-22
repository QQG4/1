#!/usr/bin/env python3
"""Запись реплик голосового гида через Azure Speech (21.11.2026): src/guide/<ru|kk>/<ключ>.mp3 и src/guide/manifest.json.
Голоса: проводник n - Даулет (kk) и Дмитрий (ru), тренер c - Айгүль (kk) и Светлана (ru). Ключ только из ~/.config/qazaq-trainer/azure.env.
Перезаписывает только изменившиеся реплики (хеш текста в манифесте); --force записывает всё заново.
Запуск из папки qazaq-trainer: python3 tools/guide/guide_tts.py [--force] [ключ ...]"""
import hashlib, html, http.client, json, os, pathlib, sys, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
env = dict(l.strip().split('=', 1) for l in pathlib.Path(os.path.expanduser('~/.config/qazaq-trainer/azure.env')).read_text().splitlines() if '=' in l and not l.startswith('#'))
KEY, REGION = env['AZURE_SPEECH_KEY'], env.get('AZURE_SPEECH_REGION', 'westeurope')
FMT = 'audio-24khz-48kbitrate-mono-mp3'
VOICES = {('n', 'kk'): ('kk-KZ-DauletNeural', 'kk-KZ'), ('c', 'kk'): ('kk-KZ-AigulNeural', 'kk-KZ'),
          ('n', 'ru'): ('ru-RU-DmitryNeural', 'ru-RU'), ('c', 'ru'): ('ru-RU-SvetlanaNeural', 'ru-RU')}
force = '--force' in sys.argv; want = set(a for a in sys.argv[1:] if not a.startswith('--'))
script = json.loads((ROOT / 'tools' / 'guide' / 'script.json').read_text(encoding='utf-8'))
out = ROOT / 'src' / 'guide'; mp = out / 'manifest.json'
man = json.loads(mp.read_text(encoding='utf-8')) if mp.exists() else {}
def synth(ssml):
    req = urllib.request.Request(f'https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1', data=ssml.encode('utf-8'), method='POST',
        headers={'Ocp-Apim-Subscription-Key': KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': FMT, 'User-Agent': 'qazaq-trainer'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return r.read()
        except (http.client.IncompleteRead, ConnectionError, TimeoutError):
            if attempt == 3: raise
            time.sleep(5 * (attempt + 1))
n = 0
for e in script:
    if want and e['key'] not in want: continue
    m = man.setdefault(e['key'], {'role': e['role']}); m['role'] = e['role']
    for lang in ('ru', 'kk'):
        text = e[lang]; h = hashlib.sha1((VOICES[(e['role'], lang)][0] + text).encode('utf-8')).hexdigest()[:10]
        f = out / lang / (e['key'] + '.mp3')
        m[lang] = text
        if not force and f.exists() and m.get(lang + '_h') == h: continue
        voice, loc = VOICES[(e['role'], lang)]
        ssml = f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{loc}"><voice name="{voice}">{html.escape(text)}</voice></speak>'
        data = synth(ssml); f.parent.mkdir(parents=True, exist_ok=True); f.write_bytes(data)
        m[lang + '_h'] = h; m[lang + '_s'] = round(len(data) * 8 / 48000, 1); n += 1
        time.sleep(0.2)
mp.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding='utf-8')
print('записано файлов:', n, '| всего реплик:', len(man))
