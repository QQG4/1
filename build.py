#!/usr/bin/env python3
"""Собирает src/ в три файла:
   docs/index.html    — сайт (GitHub Pages публикует папку docs/): аудио — отдельные файлы docs/audio/*.mp3
   dist/index.html    — то же одним файлом (аудио data-URI), открывается локально без сервера
   dist/artifact.html — тело без <html>/<head>, для публикации как Artifact (аудио data-URI: внешние файлы в артефакте запрещены)
Источники литературы берутся из ../база/sources.json → KZ.sources (страница #/sources).
"""
import pathlib, glob, json, base64, shutil
root = pathlib.Path(__file__).parent
src = root / 'src'
tpl = (src / 'index.html').read_text(encoding='utf-8')
css = (src / 'styles.css').read_text(encoding='utf-8')

def read(p): return pathlib.Path(p).read_text(encoding='utf-8')
data = [read(src / 'data' / 'exams.js'), read(src / 'data' / 'site.js')]
for f in sorted(glob.glob(str(src / 'data' / 'tests' / '*.js'))): data.append(read(f))
for f in sorted(glob.glob(str(src / 'data' / 'course' / '*.js'))): data.append(read(f))

# источники литературы
srcs = root.parent / 'база' / 'sources.json'
if srcs.exists():
    S = json.loads(srcs.read_text(encoding='utf-8'))['sources']
    keep = [{k: s.get(k) for k in ('id', 'tier', 'level', 'kind', 'author', 'year', 'title')} for s in S]
    data.append('KZ.sources = ' + json.dumps(keep, ensure_ascii=False) + ';')

# аудио: манифест общий, src — файл (сайт) или data-URI (артефакт/локальный файл)
manifest = json.loads((root / 'audio' / 'manifest.json').read_text(encoding='utf-8')) if (root / 'audio' / 'manifest.json').exists() else {}
def audio_js(mode):
    bundle = {}
    for tid, m in manifest.items():
        mp3 = root / 'audio' / (tid + '.mp3')
        if not mp3.exists(): continue
        srcv = 'audio/' + tid + '.mp3' if mode == 'site' else 'data:audio/mpeg;base64,' + base64.b64encode(mp3.read_bytes()).decode()
        bundle[tid] = {'src': srcv, 'voices': m['voices'], 'seconds': m['seconds']}
    return 'KZ.audio = ' + json.dumps(bundle, ensure_ascii=False) + ';'

app = read(src / 'i18n.js') + '\n' + read(src / 'app.js') + '\n' + read(src / 'course.js') if (src / 'i18n.js').exists() else read(src / 'app.js') + '\n' + read(src / 'course.js')
def body(mode):
    return tpl.replace('/*STYLES*/', css).replace('/*DATA*/', '\n'.join(data + [audio_js(mode)])).replace('/*APP*/', app)
def full(mode, extra_head=''):
    return ('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="description" content="Qazaq Trainer — тренажёр для подготовки к ҚАЗТЕСТ и QazResmiTest: мок-тесты по уровням, курс лексики и грамматики">'
            '<style>:root{color-scheme:light dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>' + extra_head + '</head><body>'
            + body(mode) + '</body></html>')

site_cfg = {}
try:
    import re
    m = re.search(r"analyticsSnippet:\s*'([^']*)'", read(src / 'data' / 'site.js')); site_cfg['analytics'] = m.group(1) if m else ''
except Exception: site_cfg['analytics'] = ''

(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'artifact.html').write_text(body('inline'), encoding='utf-8')
(root / 'dist' / 'index.html').write_text(full('inline'), encoding='utf-8')
docs = root / 'docs'; docs.mkdir(exist_ok=True)
(docs / 'index.html').write_text(full('site', site_cfg['analytics']), encoding='utf-8')
(docs / '.nojekyll').write_text('', encoding='utf-8')
(docs / 'audio').mkdir(exist_ok=True)
for tid in manifest:
    mp3 = root / 'audio' / (tid + '.mp3')
    if mp3.exists(): shutil.copyfile(mp3, docs / 'audio' / (tid + '.mp3'))
print('built: docs/index.html (%d KB, сайт), dist/index.html (%d KB), dist/artifact.html' % ((docs / 'index.html').stat().st_size // 1024, (root / 'dist' / 'index.html').stat().st_size // 1024))
