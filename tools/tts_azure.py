#!/usr/bin/env python3
"""Озвучка скриптов аудирования через Azure Speech (kk-KZ Aigul / Daulet).
Ключ читается ТОЛЬКО из ~/.config/qazaq-trainer/azure.env (в проект не попадает).
Выход: audio/<testId>.mp3 и audio/manifest.json; KZ.audio собирает build.py (файлы для сайта, data-URI для артефакта).
Запуск из папки qazaq-trainer: python3 tools/tts_azure.py [testId ...]
"""
import http.client, time
import os, re, sys, json, base64, pathlib, urllib.request, html

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = pathlib.Path(os.path.expanduser('~/.config/qazaq-trainer/azure.env'))
env = dict(l.strip().split('=', 1) for l in ENV.read_text().splitlines() if '=' in l and not l.startswith('#'))
KEY, REGION = env['AZURE_SPEECH_KEY'], env.get('AZURE_SPEECH_REGION', 'westeurope')
OPTS = {a.split('=')[0][2:]: a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--')}
A, D = 'kk-KZ-AigulNeural', 'kk-KZ-DauletNeural'
FIRST = {'qrt-a1-01': D, 'qrt-a2-01': A, 'qrt-b1-01': A, 'qrt-b2-01': D, 'qrt-c1-01': D, 'qrt-c2-01': D, 'kaztest-a1-01': A, 'kaztest-a2-01': D, 'kaztest-b1-01': D, 'kaztest-b2-01': D, 'kaztest-c1-01': A,
         'qrt-a1-02': A, 'qrt-a2-02': D, 'qrt-b1-02': A, 'qrt-b2-02': D, 'qrt-c1-02': A, 'qrt-c2-02': D,
         'kaztest-a1-02': A, 'kaztest-a2-02': D, 'kaztest-b1-02': A, 'kaztest-b2-02': D, 'kaztest-c1-02': A,
         'kaztest-a1-03': D, 'kaztest-a1-04': A, 'kaztest-a1-05': D, 'qrt-a1-03': D, 'qrt-a1-04': A, 'qrt-a1-05': D,
         'kaztest-a2-03': A, 'kaztest-a2-04': D, 'kaztest-a2-05': A, 'qrt-a2-03': A, 'qrt-a2-04': D, 'qrt-a2-05': A,
         'kaztest-b1-03': D, 'kaztest-b1-04': A, 'kaztest-b1-05': D, 'qrt-b1-03': D, 'qrt-b1-04': A, 'qrt-b1-05': D,
         'kaztest-b2-03': A, 'kaztest-b2-04': D, 'kaztest-b2-05': A, 'qrt-b2-03': A, 'qrt-b2-04': D, 'qrt-b2-05': A,
         'kaztest-c1-03': D, 'kaztest-c1-04': A, 'kaztest-c1-05': D, 'qrt-c1-03': D, 'qrt-c1-04': A, 'qrt-c1-05': D,
         'qrt-c2-03': A, 'qrt-c2-04': D, 'qrt-c2-05': A,
         'kaztest-listen-01-p1': D, 'kaztest-listen-01-p2': A, 'kaztest-listen-01-p3': D, 'kaztest-listen-01-p4': D,
         'qrt-listen-b1-01': D,
         'kaztest-listen-02-p1': A, 'kaztest-listen-02-p2': D, 'kaztest-listen-02-p3': A, 'kaztest-listen-02-p4': D,
         'kaztest-listen-03-p1': D, 'kaztest-listen-03-p2': A, 'kaztest-listen-03-p3': D, 'kaztest-listen-03-p4': D,
         'kaztest-listen-04-p1': A, 'kaztest-listen-04-p2': D, 'kaztest-listen-04-p3': A, 'kaztest-listen-04-p4': D,
         'kaztest-listen-05-p1': D, 'kaztest-listen-05-p2': A, 'kaztest-listen-05-p3': D, 'kaztest-listen-05-p4': D,
         'kaztest-listen-06-p1': A, 'kaztest-listen-06-p2': D, 'kaztest-listen-06-p3': A, 'kaztest-listen-06-p4': D,
         'kaztest-listen-07-p1': D, 'kaztest-listen-07-p2': A, 'kaztest-listen-07-p3': D, 'kaztest-listen-07-p4': D,
         'kaztest-listen-08-p1': A, 'kaztest-listen-08-p2': D, 'kaztest-listen-08-p3': A, 'kaztest-listen-08-p4': D,
         'kaztest-listen-09-p1': D, 'kaztest-listen-09-p2': A, 'kaztest-listen-09-p3': D, 'kaztest-listen-09-p4': D,
         'kaztest-listen-10-p1': A, 'kaztest-listen-10-p2': D, 'kaztest-listen-10-p3': A, 'kaztest-listen-10-p4': D,
         'qrt-listen-a1-01': D, 'qrt-listen-a1-02': D, 'qrt-listen-a1-03': A, 'qrt-listen-a2-01': D, 'qrt-listen-a2-02': D, 'qrt-listen-a2-03': A, 'qrt-listen-b1-02': D, 'qrt-listen-b1-03': D, 'qrt-listen-b2-01': A, 'qrt-listen-b2-02': D, 'qrt-listen-b2-03': D, 'qrt-listen-c1-01': A, 'qrt-listen-c1-02': D, 'qrt-listen-c1-03': D, 'qrt-listen-c2-01': A, 'qrt-listen-c2-02': D, 'qrt-listen-c2-03': D}
# Темп 0 % для всех уровней и паузы 350 мс между репликами: выбрано пользователем по прослушиванию 06.09.2026
# (замедление −10 % делало Aigul «тормозящей»). Замедление можно вернуть флагом --rate=-10%.
# Настройки по прослушиванию пользователя 06.09.2026: тире и многоточия — как в тексте (голос сам ставит интонационную паузу),
# 96 кбит/с, паузы между предложениями точные; для A1–A2 чуть медленнее и с более длинными паузами, чем для B1+.
RATE = {'A1': '-5%', 'A2': '-3%'}
SIL_BY_LEVEL = {'A1': '400ms', 'A2': '350ms', 'B1': '300ms'}   # остальные уровни — 250ms
COMMA_DEFAULT = '150ms'
BREAK_LINE, BREAK_PARA = '400ms', '600ms'
# пробные варианты: --rate=0% (темп для всех уровней), --break=350ms (пауза между репликами), --suffix=-trial (отдельный файл, манифест не трогаем)
if 'rate' in OPTS: RATE = {k: OPTS['rate'] for k in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')}
if 'break' in OPTS: BREAK_LINE = OPTS['break']
SUFFIX = OPTS.get('suffix', '')
FMT = OPTS.get('fmt', 'audio-24khz-96kbitrate-mono-mp3')  # 96 кбит/с: меньше «металла», чем у 48

def load_tests():
    """Что озвучивать: по записи на раздел аудирования. У полного блока (sec.parts, 10.10.2026) — по записи на каждый
    текст: id «<тест>-p1», «-p2»… Тест читается через node: в файлах данных у текстов уже не один шаблон."""
    js = ("global.KZ={tests:[]};const fs=require('fs');for(const f of fs.readdirSync('src/data/tests').sort())require('./src/data/tests/'+f);"
          "const out=[];for(const t of KZ.tests)for(const s of t.sections){if(s.type!=='listening')continue;"
          "if(s.parts)s.parts.forEach((p,i)=>out.push({id:t.id+'-p'+(i+1),test:t.id,level:(p.label||t.level).split(/[–-]/).pop(),title:p.script.title,text:p.script.text}));"
          "else if(s.script)out.push({id:t.id,test:t.id,level:t.level,title:s.script.title,text:s.script.text});}"
          "process.stdout.write(JSON.stringify(out));")
    import subprocess
    r = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)

SIL = OPTS.get('sil'); COMMA = OPTS.get('comma', COMMA_DEFAULT)
def silence(level='B2'):
    sil = SIL or SIL_BY_LEVEL.get(level, '250ms')
    return f'<mstts:silence type="Sentenceboundary-exact" value="{sil}"/>' + (f'<mstts:silence type="Comma-exact" value="{COMMA}"/>' if COMMA else '')
DASH = OPTS.get('dash', 'keep')   # 'break' — тире внутри предложения → запятая + короткая пауза; 'comma' — только запятая; 'keep' — как в тексте
DASH_MS = OPTS.get('dashms', '250ms')
def for_speech(text):
    """Только для синтеза (текст на экране не меняется). Возвращает уже экранированный SSML-фрагмент."""
    text = re.sub(r'[ \t]{2,}', ' ', text)
    if DASH == 'keep': return html.escape(text)
    parts = re.split(r'\s+[—–]\s+', text)              # «Менің атым — Айгерім»
    if DASH == 'comma': return html.escape(', '.join(parts).replace('…', '.'))
    return f',<break time="{DASH_MS}"/> '.join(html.escape(x) for x in parts).replace('…', '.')

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
            spoken = for_speech(re.sub(r'^—\s*', '', l))
            parts.append(f'<voice name="{v}">{silence(t['level'])}<prosody rate="{rate}">{spoken}</prosody><break time="{BREAK_LINE}"/></voice>')
            v = other if v == first else first
    else:
        paras = [for_speech(p.strip()) for p in t['text'].split('\n\n') if p.strip()]
        body = f'<break time="{BREAK_PARA}"/>'.join(f'<prosody rate="{rate}">{p.replace(chr(10), " ")}</prosody>' for p in paras)
        parts.append(f'<voice name="{first}">{silence(t['level'])}{body}</voice>')
    voices = 'Aigul + Daulet' if dialog else ('Aigul' if first == A else 'Daulet')
    return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="kk-KZ">' + ''.join(parts) + '</speak>', voices

def synth(ssml):
    req = urllib.request.Request(f'https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1', data=ssml.encode('utf-8'), method='POST',
        headers={'Ocp-Apim-Subscription-Key': KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': FMT, 'User-Agent': 'qazaq-trainer'})
    for attempt in range(4):   # Azure иногда обрывает ответ (IncompleteRead) — повторяем с паузой (17.09.2026)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except (http.client.IncompleteRead, ConnectionError, TimeoutError) as e:
            if attempt == 3: raise
            print(f'  обрыв ответа Azure ({type(e).__name__}), повтор через {5 * (attempt + 1)} с', file=sys.stderr)
            time.sleep(5 * (attempt + 1))

want = set(a for a in sys.argv[1:] if not a.startswith('--'))
tests = [t for t in load_tests() if not want or t['id'] in want or t['test'] in want]   # id теста озвучивает все его части
manifest_path = ROOT / 'audio' / 'manifest.json'
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
for t in tests:
    ssml, voices = ssml_for(t)
    data = synth(ssml)
    (ROOT / 'audio' / f"{t['id']}{SUFFIX}.mp3").write_bytes(data)
    kbps = int(re.search(r'(\d+)kbitrate', FMT).group(1)); secs = round(len(data) * 8 / (kbps * 1000))
    if not SUFFIX: manifest[t['id']] = {'title': t['title'], 'voices': voices, 'bytes': len(data), 'seconds': secs, 'format': FMT, 'chars': len(t['text'])}
    print(f"{t['id']}{SUFFIX:8} {voices:15} {len(data)//1024:4} KB ~{secs//60}:{secs%60:02d}  {t['title'][:40]}")
if not SUFFIX: manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1))

# data-URI bundle for the artifact
