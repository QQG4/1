#!/usr/bin/env python3
"""Озвучка скриптов аудирования через Azure Speech (kk-KZ Aigul / Daulet).
Ключ читается ТОЛЬКО из ~/.config/qazaq-trainer/azure.env (в проект не попадает).
Выход: audio/<testId>.mp3 и audio/manifest.json; KZ.audio собирает build.py (файлы для сайта, data-URI для артефакта).
Запуск из папки qazaq-trainer: python3 tools/tts_azure.py [testId ...]
"""
import os, re, sys, json, base64, pathlib, urllib.request, html

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = pathlib.Path(os.path.expanduser('~/.config/qazaq-trainer/azure.env'))
env = dict(l.strip().split('=', 1) for l in ENV.read_text().splitlines() if '=' in l and not l.startswith('#'))
KEY, REGION = env['AZURE_SPEECH_KEY'], env.get('AZURE_SPEECH_REGION', 'westeurope')
A, D = 'kk-KZ-AigulNeural', 'kk-KZ-DauletNeural'
FIRST = {'qrt-a1-01': D, 'qrt-a2-01': A, 'qrt-b1-01': A, 'qrt-b2-01': D, 'qrt-c1-01': D, 'qrt-c2-01': D, 'kaztest-a1-01': A, 'kaztest-a2-01': D, 'kaztest-b1-01': D, 'kaztest-b2-01': D, 'kaztest-c1-01': A,
         'qrt-a1-02': A, 'qrt-a2-02': D, 'qrt-b1-02': A, 'qrt-b2-02': D, 'qrt-c1-02': A, 'qrt-c2-02': D,
         'kaztest-a1-02': A, 'kaztest-a2-02': D, 'kaztest-b1-02': A, 'kaztest-b2-02': D, 'kaztest-c1-02': A}
RATE = {'A1': '-10%', 'A2': '-8%', 'B1': '-5%'}
FMT = 'audio-24khz-48kbitrate-mono-mp3'

def load_tests():
    out = []
    for f in sorted((ROOT / 'src/data/tests').glob('*.js')):
        s = f.read_text(encoding='utf-8')
        tid = re.search(r"id: '([^']+)'", s).group(1)
        lvl = re.search(r"level: '([^']+)'", s).group(1)
        m = re.search(r"type: 'listening',[\s\S]*?script: \{\s*title: '((?:[^'\\]|\\.)*)',\s*text: '((?:[^'\\]|\\.)*)'", s)
        if not m: continue
        title = m.group(1).replace("\\'", "'")
        text = m.group(2).replace('\\n', '\n').replace("\\'", "'")
        out.append({'id': tid, 'level': lvl, 'title': title, 'text': text})
    return out

def ssml_for(t):
    first = FIRST.get(t['id'], A); other = D if first == A else A
    rate = RATE.get(t['level'], '0%')
    lines = [l.strip() for l in t['text'].split('\n')]
    dialog = sum(1 for l in lines if l.startswith('—')) >= 3
    parts = []
    if dialog:
        v = first
        for l in lines:
            if not l: continue
            spoken = re.sub(r'^—\s*', '', l)
            parts.append(f'<voice name="{v}"><prosody rate="{rate}">{html.escape(spoken)}</prosody><break time="500ms"/></voice>')
            v = other if v == first else first
    else:
        paras = [p.strip() for p in t['text'].split('\n\n') if p.strip()]
        body = '<break time="700ms"/>'.join(f'<prosody rate="{rate}">{html.escape(p.replace(chr(10), " "))}</prosody>' for p in paras)
        parts.append(f'<voice name="{first}">{body}</voice>')
    voices = 'Aigul + Daulet' if dialog else ('Aigul' if first == A else 'Daulet')
    return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="kk-KZ">' + ''.join(parts) + '</speak>', voices

def synth(ssml):
    req = urllib.request.Request(f'https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1', data=ssml.encode('utf-8'), method='POST',
        headers={'Ocp-Apim-Subscription-Key': KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': FMT, 'User-Agent': 'qazaq-trainer'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

want = set(sys.argv[1:])
tests = [t for t in load_tests() if not want or t['id'] in want]
manifest_path = ROOT / 'audio' / 'manifest.json'
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
for t in tests:
    ssml, voices = ssml_for(t)
    data = synth(ssml)
    (ROOT / 'audio' / f"{t['id']}.mp3").write_bytes(data)
    secs = round(len(data) * 8 / 48000)
    manifest[t['id']] = {'title': t['title'], 'voices': voices, 'bytes': len(data), 'seconds': secs, 'format': FMT, 'chars': len(t['text'])}
    print(f"{t['id']:15} {voices:15} {len(data)//1024:4} KB ~{secs//60}:{secs%60:02d}  {t['title'][:40]}")
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1))

# data-URI bundle for the artifact
