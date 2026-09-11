#!/usr/bin/env python3
"""Собирает src/ в четыре файла:
   docs/index.html    — сайт (GitHub Pages публикует папку docs/): аудио — отдельные файлы docs/audio/*.mp3
   docs/demo/index.html — демо для показа клиентам: только мок-тесты, без курса (данные курса не включаются, KZ.site.demo = true),
                        аудио — те же файлы ../audio/*.mp3; адрес <siteUrl>demo/
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
course_data = [read(f) for f in sorted(glob.glob(str(src / 'data' / 'course' / '*.js')))]

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
        srcv = ('audio/' if mode == 'site' else '../audio/') + tid + '.mp3' if mode in ('site', 'demo') else 'data:audio/mpeg;base64,' + base64.b64encode(mp3.read_bytes()).decode()
        bundle[tid] = {'src': srcv, 'voices': m['voices'], 'seconds': m['seconds']}
    return 'KZ.audio = ' + json.dumps(bundle, ensure_ascii=False) + ';'

app = read(src / 'i18n.js') + '\n' + read(src / 'app.js') + '\n' + read(src / 'course.js') if (src / 'i18n.js').exists() else read(src / 'app.js') + '\n' + read(src / 'course.js')
def body(mode):
    extra = ['KZ.site.demo = true;'] if mode == 'demo' else course_data
    return tpl.replace('/*STYLES*/', css).replace('/*DATA*/', '\n'.join(data + extra + [audio_js(mode)])).replace('/*APP*/', app)
def full(mode, extra_head=''):
    desc = ('Qazaq Trainer — мок-тесты ҚАЗТЕСТ и QazResmiTest по уровням A1–C2 с аудированием, письмом и говорением' if mode == 'demo'
            else 'Qazaq Trainer — тренажёр для подготовки к ҚАЗТЕСТ и QazResmiTest: мок-тесты по уровням, курс лексики и грамматики')
    return ('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="description" content="' + desc + '">'
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
(docs / 'review').mkdir(exist_ok=True)
shutil.copyfile(src / 'review' / 'index.html', docs / 'review' / 'index.html')  # анкета эксперта — отдельная статическая страница <siteUrl>review/
(docs / 'demo').mkdir(exist_ok=True)
(docs / 'demo' / 'index.html').write_text(full('demo', site_cfg['analytics']), encoding='utf-8')
(docs / 'audio').mkdir(exist_ok=True)
for tid in manifest:
    mp3 = root / 'audio' / (tid + '.mp3')
    if mp3.exists(): shutil.copyfile(mp3, docs / 'audio' / (tid + '.mp3'))
print('built: docs/index.html (%d KB, сайт), docs/demo/index.html (%d KB, демо без курса), dist/index.html (%d KB), dist/artifact.html' % ((docs / 'index.html').stat().st_size // 1024, (docs / 'demo' / 'index.html').stat().st_size // 1024, (root / 'dist' / 'index.html').stat().st_size // 1024))
