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

site_cfg = {}
import re
_site = read(src / 'data' / 'site.js')
for key, field in (('analytics', 'analyticsSnippet'), ('url', 'siteUrl')):
    m = re.search(field + r":\s*'([^']*)'", _site); site_cfg[key] = m.group(1) if m else ''

app = read(src / 'i18n.js') + '\n' + read(src / 'app.js') + '\n' + read(src / 'course.js') if (src / 'i18n.js').exists() else read(src / 'app.js') + '\n' + read(src / 'course.js')
def body(mode):
    extra = ['KZ.site.demo = true;'] if mode == 'demo' else course_data
    return tpl.replace('/*STYLES*/', css).replace('/*DATA*/', '\n'.join(data + extra + [audio_js(mode)])).replace('/*APP*/', app)
SITE_NAME = 'Qazaq Trainer'
TITLES = {
    'site': 'Qazaq Trainer — мок-тесты ҚАЗТЕСТ и QazResmiTest',
    'demo': 'Qazaq Trainer — демо: мок-тесты ҚАЗТЕСТ и QazResmiTest',
    'inline': 'Qazaq Trainer',
}
DESCS = {
    'site': 'Бесплатные мок-тесты ҚАЗТЕСТ и QazResmiTest по уровням A1–C2: аудирование с озвучкой, чтение, письмо и говорение с таймером, как на экзамене. Без регистрации.',
    'demo': 'Демо-версия: мок-тесты ҚАЗТЕСТ и QazResmiTest по уровням A1–C2 с аудированием, письмом и говорением.',
    'inline': 'Qazaq Trainer — тренажёр для подготовки к ҚАЗТЕСТ и QazResmiTest: мок-тесты по уровням, курс лексики и грамматики',
}

def head(mode, extra_head=''):
    """<head> страницы: заголовок, описание, превью ссылки (og:image — абсолютный URL, иначе Telegram его не покажет),
       иконки. Адрес берётся из KZ.site.siteUrl — при смене домена править только src/data/site.js."""
    base = (site_cfg.get('url') or '').strip()
    if base and not base.endswith('/'): base += '/'
    page = base + ('demo/' if mode == 'demo' else '')
    ico = '../' if mode == 'demo' else ''
    h = ('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
         '<title>' + TITLES[mode] + '</title>'
         '<meta name="description" content="' + DESCS[mode] + '">'
         '<meta name="theme-color" content="#0e6e86">')
    if mode in ('site', 'demo'):
        h += ('<link rel="icon" href="' + ico + 'favicon.svg" type="image/svg+xml">'
              '<link rel="apple-touch-icon" href="' + ico + 'apple-touch-icon.png">')
        if mode == 'demo': h += '<meta name="robots" content="noindex,follow">'   # демо дублирует тесты сайта — в поиск не пускаем
        if base:
            h += ('<link rel="canonical" href="' + page + '">'
                  '<meta property="og:type" content="website"><meta property="og:site_name" content="' + SITE_NAME + '">'
                  '<meta property="og:locale" content="ru_RU">'
                  '<meta property="og:title" content="' + TITLES[mode] + '">'
                  '<meta property="og:description" content="' + DESCS[mode] + '">'
                  '<meta property="og:url" content="' + page + '">'
                  '<meta property="og:image" content="' + base + 'og.png">'
                  '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
                  '<meta name="twitter:card" content="summary_large_image">')
    h += '<style>:root{color-scheme:light dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
    return h + extra_head

def full(mode, extra_head=''):
    return '<!doctype html><html lang="ru"><head>' + head(mode, extra_head) + '</head><body>' + body(mode) + '</body></html>'

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
# robots.txt и sitemap.xml: демо закрыто от индексации, в карту сайта — только главная и анкета эксперта
_base = (site_cfg.get('url') or '').strip()
if _base and not _base.endswith('/'): _base += '/'
if _base:
    (docs / 'robots.txt').write_text('User-agent: *\nAllow: /\nDisallow: /demo/\nSitemap: ' + _base + 'sitemap.xml\n', encoding='utf-8')
    import datetime
    _d = datetime.date.today().isoformat()
    _urls = ''.join('<url><loc>%s</loc><lastmod>%s</lastmod></url>' % (_base + u, _d) for u in ('', 'review/'))
    (docs / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + _urls + '</urlset>\n', encoding='utf-8')

(docs / 'audio').mkdir(exist_ok=True)
for tid in manifest:
    mp3 = root / 'audio' / (tid + '.mp3')
    if mp3.exists(): shutil.copyfile(mp3, docs / 'audio' / (tid + '.mp3'))
print('built: docs/index.html (%d KB, сайт), docs/demo/index.html (%d KB, демо без курса), dist/index.html (%d KB), dist/artifact.html' % ((docs / 'index.html').stat().st_size // 1024, (docs / 'demo' / 'index.html').stat().st_size // 1024, (root / 'dist' / 'index.html').stat().st_size // 1024))
