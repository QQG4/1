#!/usr/bin/env python3
"""Собирает src/ в три площадки:
   docs/index.html    — ПУБЛИЧНЫЙ САЙТ (GitHub Pages, папка docs/): только бесплатные мок-тесты, без курса
                        и без платного материала; аудио — отдельные файлы docs/audio/*.mp3
   lab-site/index.html — ЛАБОРАТОРИЯ (приватный репозиторий + Cloudflare Pages, доступ по списку почт через Access):
                        тесты + курс + платный материал (src/data/paid/*.js), noindex, свой ключ прогресса.
                        Папка lab-site/ в публичный репозиторий не входит — это рабочая копия приватного репозитория.
   dist/index.html    — всё одним файлом (аудио data-URI), открывается локально без сервера
   dist/artifact.html — тело без <html>/<head>, для публикации как Artifact (внешние файлы в артефакте запрещены)
Источники литературы берутся из ../база/sources.json → KZ.sources (страница #/sources).
Курс и платные данные лежат вне git публичного репозитория (см. .gitignore): материал, за который планируем брать деньги,
не должен попадать ни в публичную сборку, ни в историю публичного репозитория.
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
paid_data = [read(f) for f in sorted(glob.glob(str(src / 'data' / 'paid' / '*.js')))]   # платные моки и прочее «в разработке» — только лаборатория

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
        srcv = 'audio/' + tid + '.mp3' if mode in ('site', 'lab') else 'data:audio/mpeg;base64,' + base64.b64encode(mp3.read_bytes()).decode()
        bundle[tid] = {'src': srcv, 'voices': m['voices'], 'seconds': m['seconds']}
    return 'KZ.audio = ' + json.dumps(bundle, ensure_ascii=False) + ';'

site_cfg = {}
import re
_site = read(src / 'data' / 'site.js')
for key, field in (('analytics', 'analyticsSnippet'), ('url', 'siteUrl'), ('events', 'eventsUrl')):
    m = re.search(field + r":\s*'([^']*)'", _site); site_cfg[key] = m.group(1) if m else ''

app = read(src / 'i18n.js') + '\n' + read(src / 'app.js') + '\n' + read(src / 'course.js') if (src / 'i18n.js').exists() else read(src / 'app.js') + '\n' + read(src / 'course.js')
def body(mode):
    # публичный сайт — только тесты; лаборатория и локальная сборка — плюс курс и платный материал
    extra = [] if mode == 'site' else course_data + (paid_data if mode == 'lab' else [])
    flag = ["KZ.site.build = '" + mode + "';"]
    return tpl.replace('/*STYLES*/', css).replace('/*DATA*/', '\n'.join(data + flag + extra + [audio_js(mode)])).replace('/*APP*/', app)
SITE_NAME = 'Qazaq Trainer'
TITLES = {
    'site': 'Qazaq Trainer — мок-тесты ҚАЗТЕСТ и QazResmiTest',
    'lab': 'Qazaq Trainer · лаборатория',
    'inline': 'Qazaq Trainer',
}
DESCS = {
    'site': 'Бесплатные мок-тесты ҚАЗТЕСТ и QazResmiTest по уровням A1–C2: аудирование с озвучкой, чтение, письмо и говорение с таймером, как на экзамене. Без регистрации.',
    'lab': 'Внутренняя сборка: мок-тесты, курс по уровням и материал в разработке. Не для публикации.',
    'inline': 'Qazaq Trainer — тренажёр для подготовки к ҚАЗТЕСТ и QazResmiTest: мок-тесты по уровням, курс лексики и грамматики',
}

def head(mode, extra_head=''):
    """<head> страницы: заголовок, описание, превью ссылки (og:image — абсолютный URL, иначе Telegram его не покажет),
       иконки. Адрес берётся из KZ.site.siteUrl — при смене домена править только src/data/site.js."""
    base = (site_cfg.get('url') or '').strip()
    if base and not base.endswith('/'): base += '/'
    page = base
    h = ('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
         '<title>' + TITLES[mode] + '</title>'
         '<meta name="description" content="' + DESCS[mode] + '">'
         '<meta name="theme-color" content="#0e6e86">')
    if mode in ('site', 'lab'):
        h += ('<link rel="icon" href="favicon.svg" type="image/svg+xml">'
              '<link rel="apple-touch-icon" href="apple-touch-icon.png">')
        if mode == 'lab': h += '<meta name="robots" content="noindex,nofollow">'   # лаборатория в поиск не попадает ни при каких условиях
        if base and mode == 'site':
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

def put_audio(dest):
    dest.mkdir(parents=True, exist_ok=True)
    for tid in manifest:
        mp3 = root / 'audio' / (tid + '.mp3')
        if mp3.exists(): shutil.copyfile(mp3, dest / (tid + '.mp3'))

# ---- публичный сайт ----
docs = root / 'docs'; docs.mkdir(exist_ok=True)
(docs / 'index.html').write_text(full('site', site_cfg['analytics']), encoding='utf-8')
(docs / '.nojekyll').write_text('', encoding='utf-8')
(docs / 'review').mkdir(exist_ok=True)
(docs / 'review' / 'index.html').write_text(read(src / 'review' / 'index.html').replace('__EVENTS_URL__', site_cfg.get('events', '')), encoding='utf-8')  # анкета эксперта <siteUrl>review/; адрес приёмника подставляется из site.js
_base = (site_cfg.get('url') or '').strip()
if _base and not _base.endswith('/'): _base += '/'
# 404, заголовки безопасности и список файлов, которые не выкладываются на Cloudflare (16.09.2026).
# Приложение маршрутизирует через #хэш, поэтому любой путь вида /что-угодно — действительно несуществующая страница:
# раньше Cloudflare отдавал на него главную с кодом 200, и мусорные адреса могли попасть в поиск.
(docs / '404.html').write_text(
    '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    '<meta name="robots" content="noindex"><title>Страница не найдена · Qazaq Trainer</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">'
    '<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#faf8f3;color:#1e2a30;display:grid;place-items:center;min-height:100vh;padding:0 16px}'
    'main{max-width:420px}a{color:#0e6e86}@media (prefers-color-scheme:dark){body{background:#10171b;color:#e9e4d8}a{color:#6fc3d4}}</style></head>'
    '<body><main><p style="font-size:.8rem;letter-spacing:.08em;opacity:.7">404</p><h1>Страница не найдена</h1>'
    '<p>Такого адреса на сайте нет. / Мұндай мекенжай сайтта жоқ.</p><p><a href="/">На главную · Басты бетке</a></p></main></body></html>\n', encoding='utf-8')
# _headers читает Cloudflare (статика на Workers); GitHub Pages его игнорирует. CSP не ставим: весь код и стили
# встроены в страницу, и политика с 'unsafe-inline' почти ничего не даёт, а сломать может многое.
(docs / '_headers').write_text(
    '/*\n'
    '  Strict-Transport-Security: max-age=31536000\n'
    '  X-Content-Type-Options: nosniff\n'
    '  Referrer-Policy: strict-origin-when-cross-origin\n'
    '  X-Frame-Options: SAMEORIGIN\n'
    '  Permissions-Policy: camera=(), geolocation=(), microphone=(self)\n'
    '/audio/*\n'
    '  Cache-Control: public, max-age=604800\n', encoding='utf-8')
# служебные файлы GitHub Pages (CNAME, .nojekyll) и сам _headers/.assetsignore на Cloudflare наружу не отдаются
(docs / '.assetsignore').write_text('CNAME\n.nojekyll\n.assetsignore\n', encoding='utf-8')
# бывшее демо для клиентов: публичный сайт теперь сам показывает только мок-тесты, поэтому старые ссылки уводим на главную
(docs / 'demo').mkdir(exist_ok=True)
(docs / 'demo' / 'index.html').write_text(
    '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Qazaq Trainer</title>'
    '<meta http-equiv="refresh" content="0; url=' + (_base or '../') + '">'
    '<p>Демо переехало на <a href="' + (_base or '../') + '">главную страницу сайта</a>.</p>', encoding='utf-8')
# свой домен: GitHub Pages берёт его из файла CNAME. Значение выводим из siteUrl, чтобы не держать адрес в двух местах
_host = _base.split('//')[-1].split('/')[0] if _base else ''
if _host and not _host.endswith('github.io'):
    (docs / 'CNAME').write_text(_host + '\n', encoding='utf-8')
elif (docs / 'CNAME').exists():
    (docs / 'CNAME').unlink()
if _base:
    (docs / 'robots.txt').write_text('User-agent: *\nAllow: /\nDisallow: /demo/\nSitemap: ' + _base + 'sitemap.xml\n', encoding='utf-8')
    import datetime
    _d = datetime.date.today().isoformat()
    _urls = ''.join('<url><loc>%s</loc><lastmod>%s</lastmod></url>' % (_base + u, _d) for u in ('', 'review/'))
    (docs / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + _urls + '</urlset>\n', encoding='utf-8')
put_audio(docs / 'audio')

# ---- лаборатория (рабочая копия приватного репозитория) ----
lab = root / 'lab-site'; lab.mkdir(exist_ok=True)
(lab / 'index.html').write_text(full('lab'), encoding='utf-8')
(lab / 'robots.txt').write_text('User-agent: *\nDisallow: /\n', encoding='utf-8')
for ico in ('favicon.svg', 'apple-touch-icon.png'):
    if (docs / ico).exists(): shutil.copyfile(docs / ico, lab / ico)
put_audio(lab / 'audio')

kb = lambda p: p.stat().st_size // 1024
print('built: docs/index.html (%d KB, сайт — только мок-тесты), lab-site/index.html (%d KB, лаборатория: +курс%s), dist/index.html (%d KB), dist/artifact.html'
      % (kb(docs / 'index.html'), kb(lab / 'index.html'), ' +платное' if paid_data else '', kb(root / 'dist' / 'index.html')))
