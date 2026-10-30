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
def local_fonts(text, href='fonts/fonts.css'):
    # Google Fonts видит IP каждого посетителя; на сайте шрифты лежат у нас (16.09.2026, см. страницу privacy/)
    import re as _re
    out = _re.sub(r"@import url\('https://fonts\.googleapis\.com/[^']*'\);\n?", '', text)
    return "@import url('" + href + "');\n" + out
def put_fonts(dest):
    dest.mkdir(parents=True, exist_ok=True)
    for f in (src / 'fonts').iterdir(): shutil.copyfile(f, dest / f.name)

def read(p): return pathlib.Path(p).read_text(encoding='utf-8')
data = [read(src / 'data' / 'exams.js'), read(src / 'data' / 'site.js')]
for f in sorted(glob.glob(str(src / 'data' / 'tests' / '*.js'))): data.append(read(f))
course_data = [read(f) for f in sorted(glob.glob(str(src / 'data' / 'course' / '*.js')))]
paid_data = [read(f) for f in sorted(glob.glob(str(src / 'data' / 'paid' / '*.js')))]   # платные моки и прочее «в разработке» — только лаборатория

# источники литературы
srcs = root.parent / 'база' / 'sources.json'
if srcs.exists():
    S = json.loads(srcs.read_text(encoding='utf-8'))['sources']
    keep = [{k: s.get(k) for k in ('id', 'tier', 'level', 'kind', 'author', 'year', 'title', 'source') if s.get(k) is not None} for s in S if s.get('site', True)]   # site: false — в базе, но не на странице литературы
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
for key, field in (('analytics', 'analyticsSnippet'), ('url', 'siteUrl'), ('events', 'eventsUrl'), ('email', 'supportEmail'),
                   ('gverify', 'googleVerify'), ('yverify', 'yandexVerify'), ('tg', 'telegramChannel')):
    m = re.search(field + r":\s*'([^']*)'", _site); site_cfg[key] = m.group(1) if m else ''

# ---- метаданные для посадочных страниц под поиск ----
# Данные экзаменов лежат в .js для браузера, поэтому их выгружает node (tools/dump_meta.js) в tools/pages-meta.json.
# Кэш коммитится: если node на машине нет, сборка берёт прошлый файл, а если нет и его — просто пропускает страницы.
import subprocess
META_CACHE = root / 'tools' / 'pages-meta.json'
def load_meta():
    try:
        out = subprocess.run(['node', str(root / 'tools' / 'dump_meta.js')], capture_output=True, text=True, timeout=60)
        if out.returncode == 0 and out.stdout.strip():
            META_CACHE.write_text(out.stdout, encoding='utf-8')
            return json.loads(out.stdout)
        print('!! dump_meta.js не отработал:', (out.stderr or '').strip()[:200])
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        print('!! node недоступен (%s) — беру tools/pages-meta.json' % type(e).__name__)
    if META_CACHE.exists(): return json.loads(META_CACHE.read_text(encoding='utf-8'))
    print('!! посадочные страницы пропущены: нет ни node, ни tools/pages-meta.json')
    return None
META = load_meta()

# ---- генератор посадочных страниц под поиск ----
# Приложение маршрутизирует через #хэш: всё после решётки на сервер не уходит и в индекс не попадает,
# поэтому у сайта был ровно один адрес для поисковика. Эти страницы статические, по одной на пару
# «экзамен × уровень» и на каждый язык (/ru/<экзамен>/<уровень>/ и /kk/...), с собственным заголовком,
# описанием, структурой блоков и списком вариантов. Кнопка ведёт внутрь приложения по прямой ссылке #/test/<id>.
# Тексты берутся только из данных: русские поля и поля *_kk. Ничего не переводим на ходу — если казахского
# поля нет, строка просто не выводится.
import html as _html
LANDING_LANGS = ('ru', 'kk')
L10N = {
    'ru': {'lang': 'ru', 'kicker_more': 'Другие уровни', 'what': 'Что проверяется на уровне', 'structure': 'Структура теста',
           'variants': 'Варианты мок-теста', 'sec': 'Раздел', 'tasks': 'Заданий', 'min': 'Минут', 'total': 'Всего на тест',
           'cta': 'Начать мок-тест', 'free': 'Бесплатно, без регистрации, результат сразу после проверки.',
           'home': 'Все экзамены и уровни', 'mins': 'мин',
           'note': 'Формат заданий — рабочая реконструкция по опубликованной структуре теста, а не копия реального интерфейса. '
                   'Письмо и говорение здесь оцениваются самопроверкой по критериям.',
           'vocab': 'Объём лексики', 'exam_page': 'Пробный тест', 'cta_first': 'Начать с варианта 1',
           'express': 'Не знаете свой уровень? Экспресс-тест за 10 минут подскажет, с какого начать →'},
    'kk': {'lang': 'kk', 'kicker_more': 'Басқа деңгейлер', 'what': 'Бұл деңгейде не тексеріледі', 'structure': 'Тест құрылымы',
           'variants': 'Сынақ тест нұсқалары', 'sec': 'Бөлім', 'tasks': 'Тапсырма', 'min': 'Минут', 'total': 'Тестке барлығы',
           'cta': 'Сынақ тестті бастау', 'free': 'Тегін, тіркелусіз, нәтиже тексеруден кейін бірден.',
           'home': 'Барлық емтихан мен деңгей', 'mins': 'мин',
           'note': 'Тапсырмалардың пішімі — тестің жарияланған құрылымы бойынша жасалған жұмыс реконструкциясы, нақты '
                   'интерфейстің көшірмесі емес. Жазылым мен айтылым мұнда критерийлер бойынша өзін-өзі тексерумен бағаланады.',
           'vocab': 'Лексика көлемі', 'exam_page': 'Сынақ тест', 'cta_first': '1-нұсқадан бастау',
           'express': 'Деңгейіңізді білмейсіз бе? 10 минуттық экспресс-тест қай деңгейден бастау керегін көрсетеді →'},
}
def _lk(o, field, lang):
    """Поле на нужном языке: для kk берём field_kk, и только если оно есть."""
    return (o.get(field + '_kk') if lang == 'kk' else o.get(field)) or ''
def _plural_ru(n, one, few, many):
    d, h = n % 10, n % 100
    return f'{n} ' + (one if d == 1 and h != 11 else few if 2 <= d <= 4 and not 12 <= h <= 14 else many)
def landing_pairs():
    """Пары «экзамен × уровень», для которых есть хотя бы один готовый мок-тест."""
    if not META: return []
    out = []
    for eid, ex in META['exams'].items():
        for lv in ex.get('examLevels', []):
            tests = [x for x in META['tests'] if x['exam'] == eid and x['level'] == lv and not x.get('block')]   # блоки аудирования — не варианты уровня
            if tests: out.append((eid, ex, lv, sorted(tests, key=lambda x: x['id'])))
    return out
def landing_url(lang, eid, lv): return f'{lang}/{eid}/{lv.lower()}/'

LANDING_CSS = (
    ':root{color-scheme:light dark;--bg:#faf8f3;--fg:#1e2a30;--mut:#5d6b73;--acc:#0e6e86;--line:#e3ded2;--card:#fff}'
    '@media (prefers-color-scheme:dark){:root{--bg:#10171b;--fg:#e9e4d8;--mut:#9fb0b8;--acc:#6fc3d4;--line:#24333a;--card:#16212612}}'
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);'
    'font:17px/1.6 ui-sans-serif,system-ui,"Segoe UI",Roboto,sans-serif}'
    'main{max-width:46rem;margin:0 auto;padding:2.5rem 1rem 4rem}'
    'a{color:var(--acc)}h1{font-size:clamp(1.6rem,4.5vw,2.3rem);line-height:1.2;margin:.2em 0 .4em}'
    'h2{font-size:1.15rem;margin:2.2em 0 .6em;padding-top:1.2em;border-top:1px solid var(--line)}'
    '.kicker{font-size:.78rem;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);margin:0}'
    '.lead{font-size:1.06rem;color:var(--mut)}'
    '.cta{display:inline-block;background:var(--acc);color:var(--bg);text-decoration:none;font-weight:600;'
    'padding:.7em 1.4em;border-radius:.5rem;margin:.4em 0}'
    'table{border-collapse:collapse;width:100%;font-size:.95rem}'
    'th,td{text-align:left;padding:.5em .6em;border-bottom:1px solid var(--line);vertical-align:top}'
    'th{font-size:.8rem;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);font-weight:600}'
    'ol{padding-left:1.2em}li{margin:.5em 0}'
    '.note{font-size:.88rem;color:var(--mut);border-left:2px solid var(--line);padding-left:.9em;margin-top:2.5em}'
    '.more{font-size:.95rem}.more a{display:inline-block;margin:.15em .7em .15em 0}'
    'footer{margin-top:2.5em;padding-top:1.2em;border-top:1px solid var(--line);font-size:.85rem;color:var(--mut)}'
    '.tbl-wrap{overflow-x:auto}'
    '.tgbox{border:1px solid var(--line);border-radius:.6rem;padding:1em 1.2em;margin:2em 0}'
    '.tgbox b{display:block;margin-bottom:.2em}.tgbox p{margin:.2em 0 .7em;color:var(--mut)}'
    '.tgbox a{font-weight:600}'
)

def page_head(lang, title, desc, url, alts=()):
    """Начало статической страницы до <main>: заголовок, описание, canonical, hreflang (alts — пары язык/адрес,
       только если у страницы есть перевод), og-теги. Без url (siteUrl пуст) — без canonical и og."""
    e = _html.escape
    h = ['<!doctype html><html lang="' + lang + '"><head><meta charset="utf-8">',
         '<meta name="viewport" content="width=device-width,initial-scale=1">',
         '<title>' + e(title) + '</title>',
         '<meta name="description" content="' + e(desc) + '">',
         '<meta name="theme-color" content="#0e6e86">',
         '<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/favicon-192.png" type="image/png" sizes="192x192"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">']
    if url:
        base = url[:url.index('/', 8) + 1]
        h.append('<link rel="canonical" href="' + e(url) + '">')
        for lg, u in alts:
            h.append('<link rel="alternate" hreflang="' + lg + '" href="' + e(u) + '">')
        h += ['<meta property="og:type" content="article">',
              '<meta property="og:site_name" content="' + SITE_NAME + '">',
              '<meta property="og:locale" content="' + ('ru_RU' if lang == 'ru' else 'kk_KZ') + '">',
              '<meta property="og:title" content="' + e(title) + '">',
              '<meta property="og:description" content="' + e(desc) + '">',
              '<meta property="og:url" content="' + e(url) + '">',
              '<meta property="og:image" content="' + e(base + 'og.png') + '">',
              '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
              '<meta name="twitter:card" content="summary_large_image">']
    h.append('<style>' + LANDING_CSS + '</style></head><body><main>')
    return h

def landing_page(lang, eid, ex, lv, tests, base):
    e = _html.escape
    T = L10N[lang]
    lvl = META['levels'].get(lv, {})
    ex_name = ex.get('name', eid)
    lvl_name = _lk(lvl, 'name', lang)
    n = len(tests)
    if lang == 'ru':
        # в заголовок — написание, которым ищут: «казтест» обычной К; официальное ҚАЗТЕСТ остаётся в H1
        alias = 'Казтест' if eid == 'kaztest' else ex_name
        # Google показывает примерно 60 знаков: держим заголовок коротким, синонимы («Казресмитест») — в описании и H1
        title = f'Пробный {alias} {lv} онлайн — {_plural_ru(n, "вариант", "варианта", "вариантов")} бесплатно'
        h1 = f'Пробный {ex_name} {lv} онлайн' + (' (Казтест)' if eid == 'kaztest' else ' (Казресмитест)')
        vheading = f'{_plural_ru(n, "вариант", "варианта", "вариантов")} мок-теста'
    else:
        title = f'{ex_name} {lv} сынақ тесті онлайн — {n} нұсқа тегін'
        h1 = f'{ex_name} {lv} сынақ тесті онлайн'
        vheading = f'{n} нұсқа'
    lead = (f'Подготовка к Казтест (ҚАЗТЕСТ, Kaztest) {lv}.' if eid == 'kaztest' else f'Подготовка к Казресмитест ({ex_name}) {lv}.') if lang == 'ru' \
           else f'{ex_name} {lv} емтиханына дайындық.'
    desc = ' '.join(x for x in (lead, _lk(ex, 'tagline', lang), _lk(lvl, 'focus', lang)) if x)
    desc = (desc[:275].rsplit(' ', 1)[0] + '…') if len(desc) > 280 else desc
    url = base + landing_url(lang, eid, lv)

    alts = [(lg, base + landing_url(lg, eid, lv)) for lg in LANDING_LANGS] + [('x-default', base + landing_url('ru', eid, lv))]
    h = page_head(lang, title, desc, url if base else '', alts)
    start = '/#/test/' + tests[0]['id']
    h.append('<p class="kicker">' + e(ex.get('kicker') or ex_name) + ' · ' + e(lv) + '</p>')
    h.append('<h1>' + e(h1) + '</h1>')
    if _lk(ex, 'tagline', lang): h.append('<p class="lead">' + e(_lk(ex, 'tagline', lang)) + '</p>')
    # вариантов несколько, а проходили почти только первый (статистика 29.10.2026): кнопка прямо говорит, что это вариант 1
    h.append('<p><a class="cta" href="' + start + '">' + e(T['cta_first'] if n > 1 else T['cta']) + '</a></p>')
    h.append('<p class="lead">' + e(T['free']) + '</p>')
    # экспресс-тест (29.10.2026): кто не знает своего уровня, сначала узнаёт его за 10 минут
    h.append('<p><a href="/#/express/' + eid + '">' + e(T['express']) + '</a></p>')

    h.append('<h2>' + e(T['what']) + ' ' + e(lv) + '</h2>')
    bits = []
    if lvl_name: bits.append('<b>' + e(lvl_name) + '.</b>')
    if _lk(lvl, 'units', lang): bits.append(e(T['vocab']) + ': ' + e(_lk(lvl, 'units', lang)) + '.')
    if bits: h.append('<p>' + ' '.join(bits) + '</p>')
    if _lk(lvl, 'focus', lang): h.append('<p>' + e(_lk(lvl, 'focus', lang)) + '</p>')

    secs = ex.get('sections') or []
    if secs:
        h.append('<h2>' + e(T['structure']) + '</h2><div class="tbl-wrap"><table><thead><tr>'
                 '<th>' + e(T['sec']) + '</th><th>' + e(T['tasks']) + '</th><th>' + e(T['min']) + '</th></tr></thead><tbody>')
        for s in secs:
            nm = (s.get('kk') if lang == 'kk' else s.get('title')) or s.get('title', '')
            d = _lk(s, 'desc', lang)
            h.append('<tr><td><b>' + e(nm) + '</b>' + ('<br><span style="color:var(--mut)">' + e(d) + '</span>' if d else '') +
                     '</td><td>' + e(_lk(s, 'tasks', lang)) + '</td><td>' + e(str(s.get('minutes', ''))) + '</td></tr>')
        h.append('</tbody></table></div>')
        if ex.get('totalMinutes'):
            h.append('<p class="lead">' + e(T['total']) + ': ' + e(str(ex['totalMinutes'])) + ' ' + e(T['mins']) + '.</p>')

    h.append('<h2>' + e(vheading) + '</h2><ol>')
    for i, x in enumerate(tests, 1):
        nm = f'{i}-нұсқа' if lang == 'kk' else f'Вариант {i}'
        sm = _lk(x, 'summary', lang)
        h.append('<li><a href="/#/test/' + e(x['id']) + '">' + e(nm) + '</a>' + (' — ' + e(sm) if sm else '') + '</li>')
    h.append('</ol>')
    # блоки аудирования ҚАЗТЕСТ и записи QazResmiTest этого уровня: выложены 10–11.10.2026, но их почти не находили
    bl = [x for x in META['tests'] if x['exam'] == eid and x.get('block') and (eid == 'kaztest' or x['level'] == lv)]
    if bl:
        nb = len(bl)
        if eid == 'kaztest':
            txt = (f'Отдельно — {_plural_ru(nb, "блок", "блока", "блоков")} аудирования, как на экзамене: четыре текста от A1–A2 до C1, 20 заданий, 20 минут.'
                   if lang == 'ru' else f'Бөлек — {nb} тыңдалым блогы, емтихандағыдай: A1–A2-ден C1-ге дейін төрт мәтін, 20 тапсырма, 20 минут.')
            href = '/#/exam/kaztest'
        else:
            txt = (f'Отдельно — {_plural_ru(nb, "запись", "записи", "записей")} аудирования уровня {lv}: одна запись, 5 заданий, 10 минут.'
                   if lang == 'ru' else f'Бөлек — {lv} деңгейінде {nb} тыңдалым жазбасы: бір жазба, 5 тапсырма, 10 минут.')
            href = '/#/test/' + sorted(bl, key=lambda x: x['id'])[0]['id']
        h.append('<p>' + e(txt) + ' <a href="' + href + '">' + ('Тыңдалымға өту →' if lang == 'kk' else 'Перейти к аудированию →') + '</a></p>')

    # Канал в Telegram: сюда приходят из поиска, и это первое место, где человек может «остаться» с нами.
    # Клик уходит событием remind с where=landing (как ссылка в подвале приложения).
    if site_cfg.get('tg'):
        tg_url = 'https://t.me/' + site_cfg['tg']   # метки Telegram не читает — клик считаем сами событием remind
        h.append('<div class="tgbox"><b>' + ('Күн сайын бір тапсырма — Telegram-да' if lang == 'kk' else 'Задание дня — в Telegram') + '</b><p>' +
                 e('Әр таңертең — сынақ тесттен бір сұрақ пен оның түсіндірмесі, ҚАЗТЕСТ тіркеу мерзімдері туралы еске салу.' if lang == 'kk'
                   else 'Каждое утро — вопрос из пробных тестов с разбором и напоминания о сроках регистрации на ҚАЗТЕСТ.') +
                 '</p><a href="' + e(tg_url) + '" data-remind="landing" target="_blank" rel="noopener">t.me/' + e(site_cfg['tg']) + ' →</a></div>')

    others = [(o_eid, o_ex, o_lv) for (o_eid, o_ex, o_lv, _t) in landing_pairs() if not (o_eid == eid and o_lv == lv)]
    if others:
        h.append('<h2>' + e(T['kicker_more']) + '</h2><p class="more">')
        for o_eid, o_ex, o_lv in others:
            h.append('<a href="/' + landing_url(lang, o_eid, o_lv) + '">' + e(o_ex.get('name', o_eid)) + ' ' + e(o_lv) + '</a>')
        h.append('</p>')

    # страницы-ответы есть только на русском
    if lang == 'ru':
        h.append('<h2>Об экзаменах</h2><p class="more">' + ''.join('<a href="/' + u + '">' + e(t) + '</a>' for u, t in INFO_LINKS) + '</p>')

    faq = faq_items(lang, eid, ex, lv, n)
    if faq:
        h.append('<h2>' + ('Частые вопросы' if lang == 'ru' else 'Жиі қойылатын сұрақтар') + '</h2>')
        for q, a in faq: h.append('<h3 style="font-size:1rem;margin:1.2em 0 .3em">' + e(q) + '</h3><p>' + e(a) + '</p>')
        h.append('<script type="application/ld+json">' + json.dumps({'@context': 'https://schema.org', '@type': 'FAQPage',
                 'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in faq]},
                 ensure_ascii=False).replace('</', '<\\/') + '</script>')
    h.append('<p class="note">' + e(T['note']) + '</p>')
    h.append('<footer><p><a href="/">' + e(T['home']) + '</a>' +
             (' · <a href="/privacy/">privacy</a>' if True else '') +
             (' · ' + e(site_cfg['email']) if site_cfg.get('email') else '') + '</p></footer>')
    h.append('</main>' + landing_script(lang, eid, lv) + '</body></html>\n')
    return ''.join(h)

def faq_items(lang, eid, ex, lv, n):
    """Вопросы-ответы на посадочной странице. Две задачи: ответить человеку и дать поиску те слова, которыми ищут
       («казтест», «казресмитест», «пробный тест», «тест по казахскому языку»), но обычными фразами, а не списком
       ключевых слов: набивку поисковики наказывают. Факты только проверенные: структура ҚАЗТЕСТ по Правилам
       (приказ МНВО РК № 458 от 23.09.2024), QazResmiTest по qrt.kz. Цены официальных экзаменов не пишем: меняются.
       Казахские формулировки написаны Claude и носителем не вычитаны."""
    if eid == 'kaztest':
        if lang == 'ru': return [
            (f'Как подготовиться к Казтест (ҚАЗТЕСТ) на уровень {lv}?',
             f'Пройдите пробный тест в формате экзамена: четыре блока (аудирование, чтение, письмо, говорение), таймер и озвученные тексты. '
             f'После каждого блока открывается разбор ответов с объяснениями. На уровне {lv} {_plural_ru(n, "вариант", "варианта", "вариантов")}, все бесплатно и без регистрации.'),
            *([(f'Сколько баллов нужно на ҚАЗТЕСТ {lv}?',
                f'От {sc["pct"][sc["levels"].index(lv)]} % в каждом блоке: {_score_row(sc, sc["levels"].index(lv))}. '
                'Таблица по всем уровням — на странице «Сколько баллов нужно на ҚАЗТЕСТ».')]
              if (sc := ex.get('scoring') or _exam('kaztest').get('scoring')) and lv in sc.get('levels', []) else []),
            ('Сколько длится ҚАЗТЕСТ и из чего он состоит?',
             'Сертификационное тестирование идёт 2 часа 7 минут: аудирование (20 заданий), чтение (40 заданий), письмо (2 задания) и говорение (2 задания). '
             'Уровень подтверждается, если в каждом блоке набран пороговый процент.'),
            ('Чем этот пробный тест отличается от официального пробного и диагностического?',
             'В официальном пробном и диагностическом тестировании только аудирование и чтение. Здесь есть все четыре блока, включая письмо '
             'и говорение с записью голоса, и разбор каждой ошибки.'),
            ('Это официальный сайт Казтест?',
             'Нет. Qazaq Trainer — независимый тренажёр для подготовки к экзамену по казахскому языку. Официальное тестирование проводит '
             'Национальный центр тестирования (testcenter.kz); формат заданий здесь воспроизведён по опубликованной структуре теста.'),
        ]
        return [
            (f'ҚАЗТЕСТ {lv} емтиханына қалай дайындалуға болады?',
             f'Емтихан форматындағы сынақ тестті тапсырыңыз: төрт блок (тыңдалым, оқылым, жазылым, айтылым), таймер және дыбысталған мәтіндер. '
             f'Әр блоктан кейін түсіндірмесі бар жауаптар талдауы ашылады. {lv} деңгейінде {n} нұсқа, барлығы тегін және тіркелусіз.'),
            ('ҚАЗТЕСТ қанша уақытқа созылады?',
             'Сертификаттау тестілеуі 2 сағат 7 минутқа созылады: тыңдалым (20 тапсырма), оқылым (40 тапсырма), жазылым (2 тапсырма) және айтылым (2 тапсырма).'),
            ('Бұл ресми сайт па?',
             'Жоқ. Qazaq Trainer — қазақ тілі емтиханына дайындалуға арналған тәуелсіз жаттықтырғыш. Ресми тестілеуді Ұлттық тестілеу орталығы (testcenter.kz) өткізеді.'),
        ]
    if lang == 'ru': return [
        (f'Как подготовиться к Казресмитест (QazResmiTest) на уровень {lv}?',
         f'Пройдите пробный тест в формате экзамена: пять разделов подряд (аудирование, лексика и орфография, чтение, письмо, интервью) '
         f'примерно за 60 минут. На уровне {lv} {_plural_ru(n, "вариант", "варианта", "вариантов")} с разбором ответов, бесплатно и без регистрации.'),
        ('Что такое QazResmiTest?',
         'Дистанционный тест на знание казахского языка (Qazaq Resmi Test, QRT). Сдаётся онлайн, результат выдаётся по шкале CEFR от A1 до C2.'),
        ('Это официальный сайт Казресмитест?',
         'Нет. Qazaq Trainer — независимый тренажёр. Официальный сайт теста — qrt.kz; формат заданий здесь воспроизведён по опубликованной структуре.'),
    ]
    return [
        (f'QazResmiTest {lv} емтиханына қалай дайындалуға болады?',
         f'Емтихан форматындағы сынақ тестті тапсырыңыз: қатарынан бес бөлім (тыңдалым, лексика және орфография, оқылым, жазылым, сұхбат), '
         f'шамамен 60 минут. {lv} деңгейінде {n} нұсқа, жауаптар талдауымен, тегін және тіркелусіз.'),
        ('Бұл ресми сайт па?',
         'Жоқ. Qazaq Trainer — тәуелсіз жаттықтырғыш. Тестің ресми сайты — qrt.kz.'),
    ]

# ---- страницы-ответы на частые поисковые вопросы (26.10.2026) ----
# С 12–25.10 поиск стал главным источником сайта, а запросы — вопросы: «сколько баллов нужно на казтест B1»,
# «как проходит казтест», «чем казтест отличается от казресмитест». Посадочные «экзамен × уровень» на них не отвечают.
# Факты — только из exams.js (scoring, sections, certificateNote, unverified, sources), то есть сверенные по PDF НЦТ
# и qrt.kz. Внутренние пороги KZ.strict сюда не попадают. Страницы только на русском: казахских текстов под них нет,
# а на ходу не переводим. Чего нет в данных (кто принимает QRT, срок его сертификата, что будет, если блоки сданы
# на разные уровни) — не утверждаем.
def _exam(eid): return (META or {}).get('exams', {}).get(eid, {})
def _sec(eid, t): return next((s for s in _exam(eid).get('sections', []) if s.get('type') == t), {})
def _tasks_short(s): return (s.get('tasks') or '').split(' · ')[0]
def _min_ru(n): return _plural_ru(n, 'минута', 'минуты', 'минут')
def _sources(eid, keep):
    return [x for x in _exam(eid).get('sources', []) if any(k in x.get('title', '') for k in keep)]
def _src_list(items):
    e = _html.escape
    return ('<h2>Источники</h2><ul>' + ''.join('<li><a href="' + e(x['url']) + '" rel="noopener">' + e(x['title']) + '</a></li>' for x in items)
            + '</ul>') if items else ''
def _first_test(eid, lv):
    return next((t[0]['id'] for (o, _x, l, t) in landing_pairs() if o == eid and l == lv), None)
def _btns(eid, lv, label=None):
    """Кнопка на тест уровня и ссылка на его посадочную."""
    e = _html.escape; tid = _first_test(eid, lv)
    if not tid: return ''
    name = _exam(eid).get('name', eid)
    return ('<p style="margin-bottom:0"><a class="cta" href="/#/test/' + e(tid) + '">' + e(label or f'Пробный {name} {lv}') + '</a></p>'
            '<p style="margin-top:.2em"><a href="/' + landing_url('ru', eid, lv) + '">Все варианты {} {} →</a></p>'.format(e(name), e(lv)))

def _sections_table(eid):
    e = _html.escape; ex = _exam(eid)
    # описания разделов идут ниже отдельными абзацами, в таблице — только объём и время
    rows = ''.join('<tr><td><b>' + e(s.get('title', '')) + '</b> <span lang="kk" style="color:var(--mut)">' + e(s.get('kk', '')) + '</span>'
                   '</td><td>' + e(s.get('tasks', '')) + '</td>'
                   '<td>' + e(str(s.get('minutes', ''))) + '</td></tr>' for s in ex.get('sections', []))
    return ('<div class="tbl-wrap"><table><thead><tr><th>Раздел</th><th>Заданий</th><th>Минут</th></tr></thead><tbody>' + rows +
            '</tbody></table></div>')

def _score_row(sc, i):
    """«10 из 20 за аудирование, 20 из 40 за чтение…» для уровня с индексом i в официальной таблице."""
    names = {'Тыңдалым': 'аудирование', 'Оқылым': 'чтение', 'Жазылым': 'письмо', 'Айтылым': 'говорение'}
    return ', '.join(f"{b['min'][i]} из {b['max']} за {names.get(b['title'], b['title'])}" for b in sc['blocks'])

def page_kaztest_scores():
    ex = _exam('kaztest'); sc = ex.get('scoring')
    if not sc: return None
    e = _html.escape; lv = sc['levels']; pct = sc['pct']
    thr = ', '.join(f'{l} — от {p} %' for l, p in zip(lv, pct))
    b1 = lv.index('B1') if 'B1' in lv else 0
    title = f'Сколько баллов нужно на Казтест {lv[0]}–{lv[-1]}: пороги по блокам'
    desc = (f'Официальные пороги ҚАЗТЕСТ: {thr} в каждом блоке. Таблица минимальных баллов по аудированию, чтению, '
            'письму и говорению для каждого уровня.')
    b = ['<p class="kicker">ҚАЗТЕСТ · баллы</p><h1>Сколько баллов нужно на ҚАЗТЕСТ (Казтест)</h1>',
         f'<p class="lead">Уровень присваивается по проценту, набранному в каждом блоке: {e(thr)}. '
         f'Например, для {lv[b1]} нужно не меньше {e(_score_row(sc, b1))}.</p>',
         '<p>Не знаете, на какой уровень идти? <a href="/#/express/kaztest">Экспресс-тест за 10 минут</a> подскажет примерный уровень, '
         'а дальше можно пройти полный пробный тест этого уровня.</p>',
         '<h2>Минимальные баллы по блокам</h2><div class="tbl-wrap"><table><thead><tr><th>Блок</th><th>Макс.</th>' +
         ''.join(f'<th>{e(l)}</th>' for l in lv) + '</tr></thead><tbody>' +
         ''.join(f'<tr><td lang="kk"><b>{e(bl["title"])}</b></td><td>{bl["max"]}</td>' + ''.join(f'<td>{m}</td>' for m in bl['min']) + '</tr>'
                 for bl in sc['blocks']) +
         '<tr><td>Порог</td><td></td>' + ''.join(f'<td>{p} %</td>' for p in pct) + '</tr></tbody></table></div>',
         '<p style="color:var(--mut);font-size:.92rem">Пороги — из «Руководства тестируемого» Национального центра тестирования '
         '(testcenter.kz, февраль 2026). Сверено ' + e((ex.get('verifiedNote') or '').rsplit('Проверено ', 1)[-1].rstrip('.')) + '.</p>']
    for i, l in enumerate(lv):
        b.append(f'<h2 id="{l.lower()}">Сколько баллов нужно на ҚАЗТЕСТ {e(l)}</h2>'
                 f'<p>От {pct[i]} % в каждом блоке: {e(_score_row(sc, i))}.</p>' + _btns('kaztest', l))
    if ex.get('certificateNote'):
        b.append('<h2>Когда приходит результат</h2><p>' + e(ex['certificateNote']) + '</p>')
    b.append('<h2>Как проверить себя заранее</h2><p>В пробном тесте все четыре блока, таймер идёт в темпе экзамена, а после каждого блока '
             'видно, сколько баллов набрано. Письмо и говорение оцениваются самопроверкой по официальным критериям. '
             'Учтите: в пробном тесте один текст целевого уровня, на экзамене в аудировании и чтении по четыре текста от A1 до C1.</p>'
             '<p class="more"><a href="/ru/kaztest/kak-prohodit/">Как проходит ҚАЗТЕСТ</a> '
             '<a href="/ru/kaztest-ili-qrt/">ҚАЗТЕСТ или QazResmiTest</a> <a href="/ru/obrazcy-zadaniy/">Образцы заданий</a></p>')
    b.append(_src_list(_sources('kaztest', ('Руководство',))))
    return 'ru/kaztest/bally/', title, desc, b

def page_kaztest_format():
    ex = _exam('kaztest'); secs = ex.get('sections') or []
    if not secs: return None
    e = _html.escape
    L, R, W, S = (_sec('kaztest', t) for t in ('listening', 'reading', 'writing', 'speaking'))
    title = f"Как проходит Казтест: {len(secs)} блока, {_plural_ru(ex.get('totalTasks') or 0, 'задание', 'задания', 'заданий')}, {ex.get('totalMinutes')} минут"
    desc = (f"Из чего состоит ҚАЗТЕСТ: аудирование ({_tasks_short(L)}, {L.get('minutes')} мин), чтение ({_tasks_short(R)}, {R.get('minutes')} мин), "
            f"письмо ({_tasks_short(W)}, {W.get('minutes')} мин) и говорение ({_tasks_short(S)}, {S.get('minutes')} мин). Баллы, пороги и результат.")
    b = ['<p class="kicker">ҚАЗТЕСТ · формат</p><h1>Как проходит ҚАЗТЕСТ (Казтест)</h1>',
         '<p class="lead">' + e(ex.get('tagline', '')) + ' ' +
         e(f"Аудирование — {_tasks_short(L)} за {_min_ru(L.get('minutes'))}, чтение — {_tasks_short(R)} за {_min_ru(R.get('minutes'))}, "
           f"письмо — {_tasks_short(W)} за {_min_ru(W.get('minutes'))}, говорение — {_tasks_short(S)} за {_min_ru(S.get('minutes'))}.") + '</p>',
         _btns('kaztest', 'B1', 'Пройти пробный ҚАЗТЕСТ'),
         '<h2>Блоки теста</h2>' + _sections_table('kaztest')]
    for s in secs:
        b.append('<h3 style="font-size:1rem;margin:1.4em 0 .3em">' + e(s.get('title', '')) + ' · <span lang="kk">' + e(s.get('kk', '')) + '</span></h3>'
                 '<p>' + e(s.get('tasks', '')) + ', ' + e(_min_ru(s.get('minutes'))) + '. ' + e(s.get('desc', '')) + '</p>')
    sc = ex.get('scoring')
    if sc:
        b.append('<h2>Как считают уровень</h2><p>' + e(sc['note'].split(' Ниже')[0]) +
                 ' Таблица минимальных баллов по каждому блоку — на странице <a href="/ru/kaztest/bally/">«Сколько баллов нужно на ҚАЗТЕСТ»</a>.</p>')
    if ex.get('certificateNote'):
        b.append('<h2>Результат и сертификат</h2><p>' + e(ex['certificateNote']) + '</p>')
    if ex.get('unverified'):
        b.append('<h2>Что официально не уточнено</h2><p>' + e(ex['unverified'][0].split('; в тренажёре')[0]) + '.</p>')
    b.append('<h2>Пробный тест по уровню</h2><p class="more">' +
             ''.join(f'<a href="/{landing_url("ru", "kaztest", l)}">ҚАЗТЕСТ {l}</a>' for (o, _x, l, _t) in landing_pairs() if o == 'kaztest') +
             '</p><p class="more"><a href="/ru/kaztest-ili-qrt/">ҚАЗТЕСТ или QazResmiTest</a> <a href="/ru/obrazcy-zadaniy/">Образцы заданий</a></p>')
    b.append(_src_list(_sources('kaztest', ('Спецификация', 'Руководство', 'Критерии', 'примеры'))))
    return 'ru/kaztest/kak-prohodit/', title, desc, b

def page_qrt_format():
    ex = _exam('qrt'); secs = ex.get('sections') or []
    if not secs: return None
    e = _html.escape
    title = 'Как проходит QazResmiTest (Казресмитест): разделы и время'
    parts = ', '.join(f"{s.get('title','').lower()} — {s.get('minutes')} мин" for s in secs)
    desc = f"{ex.get('tagline', '')} Разделы: {parts}. Что в каждом разделе и что официально не публикуется."
    b = ['<p class="kicker">QazResmiTest · формат</p><h1>Как проходит QazResmiTest (Казресмитест)</h1>',
         '<p class="lead">' + e(ex.get('tagline', '')) + ' ' + e(parts[0].upper() + parts[1:]) + '. '
         'Это один тест для всех: отдельных вариантов по уровням нет, уровень от A1 до C2 определяется по результату.</p>',
         _btns('qrt', 'B1', 'Пройти пробный QazResmiTest'),
         '<h2>Разделы теста</h2>' + _sections_table('qrt')]
    for s in secs:
        b.append('<h3 style="font-size:1rem;margin:1.4em 0 .3em">' + e(s.get('title', '')) + ' · <span lang="kk">' + e(s.get('kk', '')) + '</span></h3>'
                 '<p>' + e(s.get('tasks', '')) + ', ' + e(_min_ru(s.get('minutes'))) + '. ' + e(s.get('desc', '')) + '</p>')
    un = ex.get('unverified') or []
    # из пунктов unverified берём только то, что сказано про сам тест; описание тренажёра («в тренажёре…», «здесь…») отрезаем
    open_q = [un[0].split(' — в тренажёре')[0]] if un else []
    if len(un) > 2: open_q += [x.strip().rstrip('.') for x in re.split(r';\s|(?<=\.)\s', un[2]) if 'официально' in x]
    if len(un) > 1:
        b.append('<h2>Сколько баллов нужно на QazResmiTest</h2><p>' + e(un[1]) +
                 ' Официальные пороги по блокам есть только у ҚАЗТЕСТ — см. <a href="/ru/kaztest/bally/">«Сколько баллов нужно на ҚАЗТЕСТ»</a>.</p>')
    if open_q:
        b.append('<h2>Что официально не уточнено</h2><p>' + e('. '.join(open_q)) + '.</p>')
    b.append('<h2>Пробный тест по уровню</h2><p class="more">' +
             ''.join(f'<a href="/{landing_url("ru", "qrt", l)}">QazResmiTest {l}</a>' for (o, _x, l, _t) in landing_pairs() if o == 'qrt') +
             '</p><p class="more"><a href="/ru/kaztest-ili-qrt/">ҚАЗТЕСТ или QazResmiTest</a> <a href="/ru/obrazcy-zadaniy/">Образцы заданий</a></p>')
    b.append(_src_list(_sources('qrt', ('qrt.kz',))))
    return 'ru/qrt/kak-prohodit/', title, desc, b

def page_compare():
    k, q = _exam('kaztest'), _exam('qrt')
    if not (k.get('sections') and q.get('sections')): return None
    e = _html.escape
    kl, ql = k.get('examLevels', []), q.get('examLevels', [])
    kL, qL = _sec('kaztest', 'listening'), _sec('qrt', 'listening')
    rows = [
        ('Что это', 'Сертификационный тест Национального центра тестирования (testcenter.kz)', 'Дистанционный тест, официальный сайт — qrt.kz'),
        ('Уровни', f'{kl[0]}–{kl[-1]}', f'{ql[0]}–{ql[-1]} по шкале CEFR'),
        ('Разделы', ', '.join(s['title'].split(' и ')[0].lower() for s in k['sections']), ', '.join(s['title'].lower() for s in q['sections'])),
        ('Время', f"{k.get('totalMinutes')} минут", f"около {q.get('totalMinutes')} минут"),
        ('Заданий', f"{k.get('totalTasks')}", ', '.join(f"{s['title'].lower()} — {s['tasks']}" for s in q['sections'])),
        ('Аудирование', kL.get('desc', ''), qL.get('desc', '')),
        ('Пороги', 'Опубликованы: ' + ', '.join(f'{l} — от {p} %' for l, p in zip(k['scoring']['levels'], k['scoring']['pct'])) + ' в каждом блоке'
                   if k.get('scoring') else '—', 'Проходные баллы не публикуются'),
        ('Результат', k.get('certificateNote', '').split('. ')[0], 'Уровень по шкале CEFR от A1 до C2'),
    ]
    title = 'Казтест или Казресмитест: чем отличаются ҚАЗТЕСТ и QazResmiTest'
    desc = (f"ҚАЗТЕСТ — {len(k['sections'])} блока, {_plural_ru(k.get('totalTasks') or 0, 'задание', 'задания', 'заданий')}, {k.get('totalMinutes')} минут, уровни {kl[0]}–{kl[-1]}. "
            f"QazResmiTest — {len(q['sections'])} разделов, около {q.get('totalMinutes')} минут, шкала {ql[0]}–{ql[-1]}. Сравнение формата, баллов и результата.")
    b = ['<p class="kicker">ҚАЗТЕСТ · QazResmiTest</p><h1>Чем ҚАЗТЕСТ отличается от QazResmiTest</h1>',
         '<p class="lead">' + e(f"ҚАЗТЕСТ — сертификационный тест Национального центра тестирования: {len(k['sections'])} блока, "
                                f"{_plural_ru(k.get('totalTasks') or 0, 'задание', 'задания', 'заданий')}, {k.get('totalMinutes')} минут, уровни {kl[0]}–{kl[-1]} и официальные пороги по каждому блоку. "
                                f"QazResmiTest — дистанционный тест: {len(q['sections'])} разделов подряд, около {q.get('totalMinutes')} минут, "
                                f"результат по шкале CEFR от {ql[0]} до {ql[-1]}, проходные баллы не публикуются.") + '</p>',
         '<div class="tbl-wrap"><table><thead><tr><th></th><th>ҚАЗТЕСТ</th><th>QazResmiTest</th></tr></thead><tbody>' +
         ''.join(f'<tr><td><b>{e(a)}</b></td><td>{e(x)}</td><td>{e(y)}</td></tr>' for a, x, y in rows) + '</tbody></table></div>',
         '<h2>Какой тест сдавать</h2><p>Тот, который требует организация, куда вы подаёте результат: требования к экзамену и '
         'уровню у работодателей и ведомств разные, поэтому уточните их заранее. По содержанию тесты похожи: оба проверяют '
         'аудирование, чтение, письмо и устную речь. В QazResmiTest есть отдельный раздел лексики и орфографии, в ҚАЗТЕСТ '
         'лексико-грамматические задания входят в блок чтения.</p>',
         '<h2>Подробнее о каждом</h2><p class="more"><a href="/ru/kaztest/kak-prohodit/">Как проходит ҚАЗТЕСТ</a> '
         '<a href="/ru/kaztest/bally/">Сколько баллов нужно на ҚАЗТЕСТ</a> <a href="/ru/qrt/kak-prohodit/">Как проходит QazResmiTest</a> '
         '<a href="/ru/obrazcy-zadaniy/">Образцы заданий</a></p>',
         '<h2>Пробные тесты</h2>' + _btns('kaztest', 'B1', 'Пробный ҚАЗТЕСТ') + _btns('qrt', 'B1', 'Пробный QazResmiTest'),
         _src_list(_sources('kaztest', ('Спецификация', 'Руководство')) + _sources('qrt', ('структура',)))]
    return 'ru/kaztest-ili-qrt/', title, desc, b

def page_samples():
    sm = (META or {}).get('samples') or {}
    if not sm: return None
    import random
    e = _html.escape
    title = 'Образцы заданий Казтест и QazResmiTest по уровням A1–C2 с ответами'
    desc = ('По одному заданию каждого уровня ҚАЗТЕСТ (A1–C1) и QazResmiTest (A1–C2) с ответом и разбором. '
            'Под каждым — полный пробный тест этого уровня, бесплатно и без регистрации.')
    b = ['<p class="kicker">Образцы заданий</p><h1>Образцы заданий ҚАЗТЕСТ и QazResmiTest по уровням</h1>',
         '<p class="lead">Ниже — по одному заданию каждого уровня из наших пробных тестов, с ответом и разбором. '
         'Полный вариант в формате экзамена открывается кнопкой под заданием. Официальные примеры заданий ҚАЗТЕСТ '
         'Национальный центр тестирования публикует архивом на testcenter.kz.</p>']
    sec_ru = {'reading': 'Лексико-грамматическое задание из блока чтения', 'lexis': 'Задание из раздела «Лексика и орфография»'}
    for eid in ('kaztest', 'qrt'):
        ex = _exam(eid); name = ex.get('name', eid)
        b.append(f'<h2>{e(name)}</h2>')
        for (o, _x, lv, _t) in landing_pairs():
            q = sm.get(f'{eid}-{lv}')
            if o != eid or not q: continue
            # в данных ключ часто стоит первым; на экране приложения варианты перемешиваются — здесь тоже, но стабильно
            order = list(range(len(q['options']))); random.Random(q['test'] + q['id']).shuffle(order)
            letters = 'ABCDE'
            right = letters[order.index(q['answer'])]
            b.append(f'<h3 id="{eid}-{lv.lower()}" style="font-size:1rem;margin:1.6em 0 .3em">{e(name)} {e(lv)}</h3>'
                     f'<p style="color:var(--mut);font-size:.9rem;margin:.2em 0">{e(sec_ru.get(q["section"], ""))}</p>'
                     f'<p lang="kk"><b>{e(q["text"])}</b></p><ol type="A" lang="kk">' +
                     ''.join(f'<li>{e(q["options"][i])}</li>' for i in order) + '</ol>'
                     f'<details><summary>Ответ и разбор</summary><p><b>{right}) <span lang="kk">{e(q["options"][q["answer"]])}</span></b>. '
                     f'{e(q["explain"])}</p></details>' + _btns(eid, lv))
    b.append('<p class="more"><a href="/ru/kaztest/kak-prohodit/">Как проходит ҚАЗТЕСТ</a> <a href="/ru/qrt/kak-prohodit/">Как проходит QazResmiTest</a> '
             '<a href="/ru/kaztest/bally/">Сколько баллов нужно на ҚАЗТЕСТ</a></p>')
    b.append(_src_list(_sources('kaztest', ('примеры',))))
    return 'ru/obrazcy-zadaniy/', title, desc, b

# вторая волна (29.10.2026): уровни QazResmiTest, критерии письма и говорения ҚАЗТЕСТ, план подготовки за месяц
def _variants(eid, lv): return next((len(t) for (o, _x, l, t) in landing_pairs() if o == eid and l == lv), 0)
def _blocks(eid): return sorted(t['id'] for t in (META or {}).get('tests', []) if t['exam'] == eid and t.get('block') == 'listening')

def page_qrt_levels():
    ex = _exam('qrt'); scale = ex.get('scale') or {}
    if not scale: return None
    e = _html.escape; lv = [l for l in ex.get('examLevels', []) if l in scale]
    un = ex.get('unverified') or []
    title = f'Уровни и баллы QazResmiTest: как узнать свой уровень {lv[0]}–{lv[-1]}'
    desc = (f'QazResmiTest выдаёт результат уровнем от {lv[0]} до {lv[-1]}, проходные баллы не публикуются. Что означает каждый уровень '
            'по описанию qrt.kz и как заранее проверить свой уровень на пробных тестах.')
    b = ['<p class="kicker">QazResmiTest · уровни</p><h1>Уровни и баллы QazResmiTest (Казресмитест)</h1>',
         f'<p class="lead">QazResmiTest — один тест для всех: результат выдаётся уровнем по шкале от {lv[0]} до {lv[-1]}. '
         'Сколько баллов нужно на каждый уровень, qrt.kz не публикует, на сайте теста описаны только сами уровни. '
         'Ниже — эти описания и способ заранее понять свой уровень по пробным тестам.</p>',
         '<h2>Шесть уровней QazResmiTest</h2><div class="tbl-wrap"><table><thead><tr><th>Уровень</th><th>Что он означает (qrt.kz)</th>'
         '<th>Пробный тест</th></tr></thead><tbody>' +
         ''.join(f'<tr id="{l.lower()}"><td><b>{e(l)}</b><br><span style="color:var(--mut)">{e(scale[l]["name"])}</span></td>'
                 f'<td>{e(scale[l]["desc"])}</td><td>' +
                 (f'<a href="/{landing_url("ru", "qrt", l)}">{_plural_ru(_variants("qrt", l), "вариант", "варианта", "вариантов")}</a>' if _variants('qrt', l) else '—') +
                 '</td></tr>' for l in lv) + '</tbody></table></div>']
    b.append('<h2>Сколько баллов нужно на QazResmiTest</h2><p>' +
             e(un[1] if len(un) > 1 else 'Проходные баллы не публикуются.') +
             ' Официальной таблицы порогов, как у ҚАЗТЕСТ, у QazResmiTest нет — см. '
             '<a href="/ru/kaztest/bally/">«Сколько баллов нужно на ҚАЗТЕСТ»</a> для сравнения.</p>')
    if ex.get('sittingNote'):
        b.append('<h2>Как сдаётся тест</h2><p>По данным qrt.kz: «' + e(ex['sittingNote']) + '» ' + e(ex.get('tagline', '')) + '</p>')
    b.append('<h2>Как узнать свой уровень по пробному тесту</h2><ol>'
             '<li>Выберите уровень, на который рассчитываете, и пройдите мок-тест в режиме «как на экзамене»: таймер раздела не останавливается.</li>'
             '<li>После аудирования, лексики и чтения тренажёр покажет итог: «Ваш уровень по чтению и аудированию: B1» '
             'или разделы, в которых не хватило баллов.</li>'
             '<li>Уровень подтвердился — попробуйте следующий. Не подтвердился — пройдите уровень ниже, разберите ошибки и вернитесь.</li>'
             '<li>Письмо и интервью проверяются самопроверкой по чек-листу и в итог уровня не входят. В режиме «тренировка» уровень не подтверждается.</li></ol>'
             '<p>Реальный тест один для всех уровней, а наши мок-тесты различаются сложностью: так проще проверить, держите ли вы '
             'конкретный уровень, и тренировать именно его.</p>' + _btns('qrt', 'B1', 'Пробный QazResmiTest B1'))
    b.append('<p class="more"><a href="/ru/qrt/kak-prohodit/">Как проходит QazResmiTest</a> <a href="/ru/kaztest-ili-qrt/">ҚАЗТЕСТ или QazResmiTest</a> '
             '<a href="/ru/obrazcy-zadaniy/#qrt-b1">Образцы заданий</a></p>')
    b.append(_src_list(_sources('qrt', ('qrt.kz',))))
    return 'ru/qrt/urovni/', title, desc, b

def page_kaztest_criteria():
    c = (META or {}).get('criteria'); ex = _exam('kaztest')
    if not c: return None
    if c.get('same') != c.get('of'):
        print('!! критерии письма/говорения различаются в вариантах ҚАЗТЕСТ (%s из %s совпадают) — проверить данные' % (c.get('same'), c.get('of')))
    e = _html.escape
    W, S = c['writing'], c['speaking']
    pic = next((x for x in W if x['kind'] == 'picture'), None); ess = next((x for x in W if x['kind'] == 'essay'), None)
    if not (pic and ess and S.get('criteria')): return None
    sp_max = sum(x['max'] for x in S['criteria'])
    wsec, ssec = _sec('kaztest', 'writing'), _sec('kaztest', 'speaking')
    title = 'Критерии оценки ҚАЗТЕСТ: письмо и говорение (жазылым, айтылым)'
    desc = (f"Как оценивают письмо и говорение на Казтест: описание картинки — {pic['points']} баллов, эссе — {ess['points']}, "
            f"говорение — {len(S['tasks'])} задания по {sp_max}. Официальные критерии НЦТ и что нужно для высшего балла.")
    def tbl(crit):
        return ('<div class="tbl-wrap"><table><thead><tr><th>Критерий</th><th>Макс.</th><th>Что нужно для высшего балла</th></tr></thead><tbody>' +
                ''.join(f'<tr><td lang="kk"><b>{e(x["name"])}</b></td><td>{x["max"]}</td><td>{e(x.get("top", ""))}</td></tr>' for x in crit) +
                '</tbody></table></div>')
    b = ['<p class="kicker">ҚАЗТЕСТ · критерии</p><h1>Критерии оценки письма и говорения ҚАЗТЕСТ</h1>',
         '<p class="lead">' + e(f"Письмо и говорение ҚАЗТЕСТ оценивают по официальным критериям НЦТ, по 50 баллов за блок. "
                                f"Описание картинки — {pic['points']} баллов ({len(pic['criteria'])} критерия по {pic['criteria'][0]['max']}), "
                                f"эссе — {ess['points']} баллов ({len(ess['criteria'])} критерия по {ess['criteria'][0]['max']}), "
                                f"говорение — {len(S['tasks'])} задания по {sp_max} баллов, {len(S['criteria'])} критериев по {S['criteria'][0]['max']}.") + '</p>',
         _btns('kaztest', 'B1', 'Проверить себя на пробном ҚАЗТЕСТ'),
         f'<h2>Письмо (Жазылым): {wsec.get("tasks", "")}, {_min_ru(wsec.get("minutes") or 0)}</h2>',
         f"<h3 style=\"font-size:1rem;margin:1.4em 0 .3em\">Задание 1. Описание картинки — {pic['points']} баллов</h3>"
         f"<p>Ориентир — {_min_ru(pic['minutes'])} и от {pic.get('minWords')} слов.</p>" + tbl(pic['criteria']),
         f"<h3 style=\"font-size:1rem;margin:1.4em 0 .3em\">Задание 2. Эссе — {ess['points']} баллов</h3>"
         f"<p>{_min_ru(ess['minutes']).capitalize()}, для высшего балла — около {ess.get('minWords')} слов.</p>" + tbl(ess['criteria']),
         f'<h2>Говорение (Айтылым): {ssec.get("tasks", "")}, {_min_ru(ssec.get("minutes") or 0)}</h2>',
         '<p>' + e(ssec.get('desc', '')) + ' Оба ответа оцениваются по одним и тем же критериям.</p>' + tbl(S['criteria'])]
    sc = ex.get('scoring')
    if sc:
        bl = {x['title']: x for x in sc['blocks']}
        if 'Жазылым' in bl:
            row = ', '.join(f"{l} — {m}" for l, m in zip(sc['levels'], bl['Жазылым']['min']))
            b.append(f'<h2>Сколько баллов нужно за письмо и говорение</h2><p>Пороги одинаковые для обоих блоков (из 50): {e(row)}. '
                     'Полная таблица — на странице <a href="/ru/kaztest/bally/">«Сколько баллов нужно на ҚАЗТЕСТ»</a>.</p>')
    if ex.get('certificateNote') and '. ' in ex['certificateNote']:
        b.append('<p>' + e(ex['certificateNote'].split('. ', 1)[1]) + '</p>')
    b.append('<h2>Как потренироваться</h2><p>В пробном тесте оба задания письма и оба задания говорения идут с таймером, ответ '
             'на говорение записывается с микрофона. После раздела вы оцениваете себя по этим же критериям: так видно, на каком '
             'критерии теряются баллы.</p>'
             '<p style="color:var(--mut);font-size:.92rem">Названия критериев — как в документах НЦТ; описания высшего балла — '
             'наш краткий пересказ официальных критериев. Сверено ' +
             e((ex.get('verifiedNote') or '').rsplit('Проверено ', 1)[-1].rstrip('.')) + '.</p>')
    b.append('<p class="more"><a href="/ru/kaztest/kak-prohodit/">Как проходит ҚАЗТЕСТ</a> <a href="/ru/kaztest/podgotovka-za-mesyac/">Подготовка за месяц</a></p>')
    b.append(_src_list(_sources('kaztest', ('Критерии',))))
    return 'ru/kaztest/kriterii/', title, desc, b

def page_kaztest_month():
    ex = _exam('kaztest'); secs = ex.get('sections') or []
    pairs = [(l, t) for (o, _x, l, t) in landing_pairs() if o == 'kaztest']
    if not (secs and pairs): return None
    e = _html.escape
    nv = max(len(t) for _l, t in pairs); blocks = _blocks('kaztest')
    L, R, W, S = (_sec('kaztest', t) for t in ('listening', 'reading', 'writing', 'speaking'))
    crit = (META or {}).get('criteria') or {}
    pic = next((x for x in crit.get('writing', []) if x['kind'] == 'picture'), {}); ess = next((x for x in crit.get('writing', []) if x['kind'] == 'essay'), {})
    def lv_links(n):
        return ' '.join(f'<a href="/#/test/{e(t[n]["id"])}">{e(l)}</a>' for l, t in pairs if len(t) > n)
    blk = lambda i: (f'<a href="/#/test/{e(blocks[i])}">блок {i + 1}</a>' if i < len(blocks) else '')
    title = 'Как подготовиться к Казтест за месяц: план по неделям'
    desc = (f'План подготовки к ҚАЗТЕСТ на 4 недели: диагностика, аудирование и чтение, письмо и говорение, полные прогоны. '
            f'Бесплатные пробные тесты A1–C1 ({nv} вариантов на уровень)' + (f' и {len(blocks)} блоков аудирования.' if blocks else '.'))
    b = ['<p class="kicker">ҚАЗТЕСТ · подготовка</p><h1>Как подготовиться к ҚАЗТЕСТ за месяц</h1>',
         '<p class="lead">Четыре недели: неделя на диагностику, неделя на аудирование и чтение, неделя на письмо и говорение, '
         'неделя на полные прогоны в режиме экзамена. Всё делается на бесплатных пробных тестах в формате ҚАЗТЕСТ: ' +
         e(f'{nv} вариантов на каждый уровень от {pairs[0][0]} до {pairs[-1][0]}') + (e(f' и {len(blocks)} блоков аудирования') if blocks else '') + '.</p>',
         '<h2>Что на экзамене</h2><p>' + e(ex.get('tagline', '')) + ' ' +
         e(f"Аудирование — {_tasks_short(L)} за {_min_ru(L.get('minutes'))}, чтение — {_tasks_short(R)} за {_min_ru(R.get('minutes'))}, "
           f"письмо — {_tasks_short(W)} за {_min_ru(W.get('minutes'))}, говорение — {_tasks_short(S)} за {_min_ru(S.get('minutes'))}.") +
         ' Подробнее — <a href="/ru/kaztest/kak-prohodit/">как проходит ҚАЗТЕСТ</a> и <a href="/ru/kaztest/bally/">сколько баллов нужно</a>.</p>',
         '<h2>Неделя 1. Узнать свой уровень</h2><ol>'
         f'<li>Пройдите первый вариант своего уровня целиком, в режиме «как на экзамене»: {lv_links(0)}.</li>'
         '<li>Посмотрите итог по аудированию и чтению. Если уровень не подтвердился, пройдите первый вариант уровня ниже: '
         'так станет понятно, от чего отталкиваться.</li>'
         '<li>Выпишите, в каком блоке потеряно больше всего баллов и на каких вопросах: разбор открывается после каждого раздела.</li>' +
         (f'<li>Пройдите {blk(0)} аудирования: в нём четыре текста от A1 до C1 и 20 минут, как в настоящем блоке.</li>' if blocks else '') +
         '</ol>',
         '<h2>Неделя 2. Аудирование и чтение</h2><ol>' +
         (f'<li>Через день — один блок аудирования ({blk(1)}, {blk(2)}, {blk(3)} и дальше по порядку). После каждого читайте '
          'разбор и переслушивайте тексты, где ошиблись.</li>' if len(blocks) > 3 else '') +
         f'<li>Разделы чтения из вариантов 2 и 3 своего уровня. Вариант 2: {lv_links(1)}. Вариант 3: {lv_links(2)}.</li>'
         '<li>В блоке чтения 18 из 40 заданий лексико-грамматические. В наших вариантах это окончания, синонимы и антонимы, '
         'типы предложений: после разбора выпишите формы, на которых ошибаетесь.</li>'
         '<li>Засекайте время на каждый текст: на экзамене четыре текста и 50 минут на весь блок.</li></ol>',
         '<h2>Неделя 3. Письмо и говорение</h2><ol>' +
         (f"<li>Описание картинки: около {_min_ru(pic.get('minutes') or 10)}, от {pic.get('minWords')} слов, {pic.get('points')} баллов.</li>" if pic else '') +
         (f"<li>Эссе: {_min_ru(ess.get('minutes') or 40)}, для высшего балла около {ess.get('minWords')} слов, {ess.get('points')} баллов. "
          'Пишите по одному эссе через день из вариантов своего уровня.</li>' if ess else '') +
         '<li>Говорение: 3 минуты на подготовку и 4 на ответ. Записывайте ответ с микрофона и переслушивайте его.</li>'
         '<li>Оценивайте себя по <a href="/ru/kaztest/kriterii/">официальным критериям</a>: видно, какой критерий проседает.</li></ol>',
         '<h2>Неделя 4. Полные прогоны</h2><ol>'
         f'<li>Два полных варианта в режиме экзамена, все блоки подряд. Вариант 4: {lv_links(3)}. Вариант 5: {lv_links(4)}.</li>'
         '<li>Если уровень подтверждается уверенно, пройдите один вариант уровня выше: на экзамене тексты идут от A1 до C1.</li>'
         '<li>За два-три дня до теста новое не берите: повторите ошибки из разборов и выспитесь.</li></ol>',
         '<h2>Чего пробный тест не заменит</h2><p>' +
         e((ex.get('unverified') or ['', ''])[1].split(' — это')[0]) + '. Поэтому блоки аудирования с четырьмя текстами и полные прогоны в четвёртую неделю важны.</p>',
         _btns('kaztest', 'B1', 'Начать с пробного ҚАЗТЕСТ B1')]
    b.append('<p class="more"><a href="/ru/kaztest/kriterii/">Критерии письма и говорения</a> <a href="/ru/obrazcy-zadaniy/">Образцы заданий</a> '
             '<a href="/ru/kaztest-ili-qrt/">ҚАЗТЕСТ или QazResmiTest</a></p>')
    return 'ru/kaztest/podgotovka-za-mesyac/', title, desc, b

# короткие подписи для ссылок на страницы-ответы (посадочные и низ главной)
INFO_LINKS = [('ru/kaztest/bally/', 'Сколько баллов нужно на ҚАЗТЕСТ'), ('ru/kaztest/kak-prohodit/', 'Как проходит ҚАЗТЕСТ'),
              ('ru/qrt/kak-prohodit/', 'Как проходит QazResmiTest'), ('ru/kaztest-ili-qrt/', 'ҚАЗТЕСТ или QazResmiTest'),
              ('ru/obrazcy-zadaniy/', 'Образцы заданий по уровням'), ('ru/qrt/urovni/', 'Уровни и баллы QazResmiTest'),
              ('ru/kaztest/kriterii/', 'Критерии письма и говорения ҚАЗТЕСТ'), ('ru/kaztest/podgotovka-za-mesyac/', 'Подготовка к ҚАЗТЕСТ за месяц')]
def info_pages():
    """Все страницы-ответы: (адрес, title, description, тело). Пустой список, если нет метаданных."""
    if not META: return []
    return [p for p in (page_kaztest_scores(), page_kaztest_format(), page_qrt_format(), page_compare(), page_samples(),
                                 page_qrt_levels(), page_kaztest_criteria(), page_kaztest_month()) if p]

def info_page_html(u, title, desc, body_parts, base):
    e = _html.escape
    h = page_head('ru', title, desc, (base + u) if base else '')
    h += body_parts
    if site_cfg.get('tg'):
        h.append('<div class="tgbox"><b>Задание дня — в Telegram</b><p>Каждое утро — вопрос из пробных тестов с разбором и '
                 'напоминания о сроках регистрации на ҚАЗТЕСТ.</p><a href="https://t.me/' + e(site_cfg['tg']) +
                 '" data-remind="landing" target="_blank" rel="noopener">t.me/' + e(site_cfg['tg']) + ' →</a></div>')
    h.append('<p class="note">' + e(L10N['ru']['note']) + ' Qazaq Trainer — независимый тренажёр, не официальный сайт экзаменов.</p>')
    h.append('<footer><p><a href="/">' + e(L10N['ru']['home']) + '</a> · <a href="/privacy/">privacy</a>' +
             (' · ' + e(site_cfg['email']) if site_cfg.get('email') else '') + '</p></footer>')
    h.append('</main>' + landing_script('ru', path='lp/' + u.rstrip('/')) + '</body></html>\n')
    return ''.join(h)

def landing_script(lang, eid=None, lv=None, path=None):
    """Две вещи. (1) Просмотр посадочной страницы уходит в статистику событием pageview с путём lp/<lang>/<exam>/<level>:
       иначе заходы из поиска не видны вовсе, пока человек не нажмёт кнопку. (2) Ссылки внутрь приложения получают
       utm-метки и ?ref=<домен источника>: при переходе /ru/... → /#/test/... document.referrer становится нашим
       собственным доменом, и без этого все заходы из поиска и из Telegram записывались бы как прямые.
       Номер вкладки — тот же `kz-trainer:sid` в sessionStorage, что у приложения (29.10.2026): иначе человек,
       перешедший с посадочной в тест, считался двумя посетителями, а переход «посадочная → тест» не был виден."""
    ev = site_cfg.get('events') or ''
    return ('<script>(function(){var sp=new URLSearchParams(location.search),q=new URLSearchParams(),ref="";'
            'try{ref=document.referrer?new URL(document.referrer).hostname:""}catch(e){}'
            'if(ref===location.hostname)ref="";'
            '["utm_source","utm_medium","utm_campaign"].forEach(function(k){if(sp.get(k))q.set(k,sp.get(k).slice(0,40))});'
            'if(ref)q.set("ref",ref.replace(/^www\\./,"").slice(0,80));'
            'var qs=q.toString();if(qs)document.querySelectorAll(\'a[href^="/#"]\').forEach(function(a){a.href="/?"+qs+a.getAttribute("href").slice(1)});'
            + ('var u=' + json.dumps(ev) + ';if(u&&navigator.sendBeacon){var p={path:' + json.dumps(path or 'lp/' + lang + '/' + eid + '/' + lv.lower()) + '};'
               'if(ref)p.ref=ref.replace(/^www\\./,"").slice(0,80);var m=["utm_source","utm_medium","utm_campaign"].map(function(k){return(sp.get(k)||"").slice(0,40)});'
               'if(m.join(""))p.utm=m.join("/");'
               'var sid;try{sid=sessionStorage.getItem("kz-trainer:sid");if(!sid){sid=Date.now().toString(36)+Math.random().toString(36).slice(2,10);sessionStorage.setItem("kz-trainer:sid",sid)}}catch(e){sid=Math.random().toString(36).slice(2,12)}var send=function(n,pp){try{navigator.sendBeacon(u,new Blob([JSON.stringify({e:n,sid:sid,lang:' + json.dumps(lang) + ',ts:Date.now(),p:pp})],{type:"text/plain;charset=UTF-8"}))}catch(e){}};'
               'send("pageview",p);document.addEventListener("click",function(ev){var a=ev.target.closest&&ev.target.closest("a[data-remind]");if(a)send("remind",{where:a.getAttribute("data-remind"),path:p.path})})}'
               if ev else '')
            + '})();</script>')

def seo_nav():
    """Ссылки на посадочные страницы в самом низу главной: без них страницы были бы сиротами для поисковика."""
    pairs = landing_pairs()
    if not pairs: return ''
    out = ['<nav class="seo-nav" aria-label="Страницы по экзаменам и уровням">'
           '<style>.seo-nav{max-width:46rem;margin:0 auto;padding:1.5rem 1rem 3rem;font-size:.85rem;opacity:.75}'
           '.seo-nav b{display:block;font-weight:600;margin-bottom:.5em}'
           '.seo-nav a{display:inline-block;margin:.15em .8em .15em 0}</style>'
           '<p style="max-width:40rem">Qazaq Trainer — бесплатные пробные тесты для подготовки к экзаменам по казахскому языку: '
           'Казтест (ҚАЗТЕСТ, Kaztest) и Казресмитест (QazResmiTest, QRT). Все блоки экзамена, включая письмо и говорение, '
           'таймер, озвученное аудирование и разбор ошибок. Без регистрации. · Қазақ тілінен ҚАЗТЕСТ пен QazResmiTest '
           'емтихандарына дайындыққа арналған тегін сынақ тестер.</p>'
           '<b>Пробные тесты по экзаменам и уровням · Емтихан мен деңгей бойынша сынақ тестер</b>']
    for eid, ex, lv, _t in pairs:
        out.append('<a href="/' + landing_url('ru', eid, lv) + '">' + _html.escape(ex.get('name', eid)) + ' ' + lv + '</a>')
    if info_pages():
        out.append('<b style="margin-top:1em">Вопросы об экзаменах</b>')
        for u, t in INFO_LINKS: out.append('<a href="/' + u + '">' + _html.escape(t) + '</a>')
    out.append('<a href="/kk/' + pairs[0][0] + '/' + pairs[0][2].lower() + '/" hreflang="kk">Қазақша</a>')
    out.append('</nav>')
    return ''.join(out)


app = read(src / 'i18n.js') + '\n' + read(src / 'app.js') + '\n' + read(src / 'course.js') if (src / 'i18n.js').exists() else read(src / 'app.js') + '\n' + read(src / 'course.js')
app += '\n' + read(src / 'express.js')   # экспресс-тест «Узнать уровень за 10 минут» (29.10.2026), во всех сборках
def body(mode):
    # публичный сайт — только тесты; лаборатория и локальная сборка — плюс курс и платный материал
    extra = [] if mode == 'site' else course_data + (paid_data if mode == 'lab' else [])
    flag = ["KZ.site.build = '" + mode + "';"]
    # сайт и лаборатория берут шрифты со своего сервера (src/fonts → fonts/), автономный dist — по-прежнему с Google Fonts
    return (tpl.replace('/*STYLES*/', local_fonts(css) if mode in ('site', 'lab') else css)
               .replace('/*DATA*/', '\n'.join(data + flag + extra + [audio_js(mode)]))
               .replace('/*APP*/', app)
               .replace('/*SEONAV*/', seo_nav() if mode == 'site' else ''))
SITE_NAME = 'Qazaq Trainer'
TITLES = {
    # люди ищут «казтест» обычной К, а в тексте было только официальное ҚАЗТЕСТ с Қ: для поиска это разные слова (19.09.2026)
    'site': 'Казтест и QazResmiTest — бесплатные пробные тесты A1–C2',
    'lab': 'Qazaq Trainer · лаборатория',
    'inline': 'Qazaq Trainer',
}
DESCS = {
    'site': 'Подготовка к Казтест (ҚАЗТЕСТ, Kaztest) и Казресмитест (QazResmiTest). Бесплатные пробные тесты по уровням A1–C2: аудирование с озвучкой, чтение, письмо и говорение с таймером, как на экзамене. Без регистрации.',
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
        h += ('<link rel="icon" href="favicon.ico" sizes="48x48">'
              '<link rel="icon" href="favicon-192.png" type="image/png" sizes="192x192">'
              '<link rel="icon" href="favicon.svg" type="image/svg+xml">'
              '<link rel="apple-touch-icon" href="apple-touch-icon.png">')
        if mode == 'lab': h += '<meta name="robots" content="noindex,nofollow">'   # лаборатория в поиск не попадает ни при каких условиях
        if mode == 'site':   # подтверждение прав в Search Console / Вебмастере — только на публичной главной
            if site_cfg.get('gverify'): h += '<meta name="google-site-verification" content="' + site_cfg['gverify'] + '">'
            if site_cfg.get('yverify'): h += '<meta name="yandex-verification" content="' + site_cfg['yverify'] + '">'
        if base and mode == 'site':
            h += ('<link rel="canonical" href="' + page + '">'
                  '<meta property="og:type" content="website"><meta property="og:site_name" content="' + SITE_NAME + '">'
                  '<meta property="og:locale" content="ru_RU">'
                  '<meta property="og:title" content="' + TITLES[mode] + '">'
                  '<meta property="og:description" content="' + DESCS[mode] + '">'
                  '<meta property="og:url" content="' + page + '">'
                  '<meta property="og:image" content="' + base + 'og.png">'
                  '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
                  '<meta name="twitter:card" content="summary_large_image">'
                  # название и логотип сайта для выдачи поисковиков
                  '<script type="application/ld+json">' + json.dumps({'@context': 'https://schema.org', '@graph': [
                      {'@type': 'WebSite', '@id': base + '#site', 'url': base, 'name': SITE_NAME, 'inLanguage': ['ru', 'kk']},
                      {'@type': 'Organization', '@id': base + '#org', 'url': base, 'name': SITE_NAME, 'logo': base + 'favicon-192.png',
                       'sameAs': ['https://t.me/qazaqtrainer', 'https://www.instagram.com/qazaq.trainer/']}]}, ensure_ascii=False) + '</script>')
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

def _re_fonts(html):
    import re as _re
    return _re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"]*">', '<link rel="stylesheet" href="/fonts/fonts.css">', html)

# ---- публичный сайт ----
docs = root / 'docs'; docs.mkdir(exist_ok=True)
(docs / 'index.html').write_text(full('site', site_cfg['analytics']), encoding='utf-8')
(docs / '.nojekyll').write_text('', encoding='utf-8')
# Вопросы для «задания дня» в Telegram: файл читает воркер tools/events-worker (раз в сутки).
# Ссылку на тест он строит сам из exam/level, поэтому здесь только вопросы.
if META and META.get('quiz'):
    (docs / 'quiz.json').write_text(json.dumps(META['quiz'], ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('docs/quiz.json: %d заданий (%s)' % (sum(len(v) for v in META['quiz'].values()), ', '.join('%s %d' % (k, len(v)) for k, v in META['quiz'].items())))
def _tests_count_ru():
    """«27 мок-тестов» для анкеты эксперта: число файлов в src/data/tests, чтобы подпись не устаревала при добавлении вариантов."""
    n = len(glob.glob(str(src / 'data' / 'tests' / '*.js'))); d, h = n % 10, n % 100
    return f"{n} " + ('пробный тест' if d == 1 and h != 11 else 'пробных теста' if 2 <= d <= 4 and not 12 <= h <= 14 else 'пробных тестов')
(docs / 'review').mkdir(exist_ok=True)
(docs / 'review' / 'index.html').write_text(_re_fonts(read(src / 'review' / 'index.html')).replace('__EVENTS_URL__', site_cfg.get('events', '')).replace('__SUPPORT_EMAIL__', site_cfg.get('email', '')).replace('__TESTS_COUNT__', _tests_count_ru()), encoding='utf-8')  # анкета эксперта <siteUrl>review/; адрес приёмника подставляется из site.js
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
    '<p>Такого адреса на сайте нет. / Мұндай мекенжай сайтта жоқ.</p><p><a href="/">На главную · Басты бетке</a></p>'
    + (f'<p style="font-size:.9rem;opacity:.8">{site_cfg["email"]}</p>' if site_cfg.get('email') else '') + '</main></body></html>\n', encoding='utf-8')
# _headers читает Cloudflare (статика на Workers); GitHub Pages его игнорирует. CSP не ставим: весь код и стили
# встроены в страницу, и политика с 'unsafe-inline' почти ничего не даёт, а сломать может многое.
# Исключение — frame-ancestors (с 21.09.2026 вместо X-Frame-Options: SAMEORIGIN): сайт открывается как Mini App бота
# @qazaqtrainer_bot, а веб-версия Telegram показывает его во фрейме. Разрешены только свой домен и web.telegram.org;
# в мобильных и настольных приложениях Telegram это обычный встроенный браузер, фрейма там нет.
(docs / '_headers').write_text(
    '/*\n'
    '  Strict-Transport-Security: max-age=31536000\n'
    '  X-Content-Type-Options: nosniff\n'
    '  Referrer-Policy: strict-origin-when-cross-origin\n'
    "  Content-Security-Policy: frame-ancestors 'self' https://web.telegram.org\n"
    '  Permissions-Policy: camera=(), geolocation=(), microphone=(self)\n'
    '/audio/*\n'
    '  Cache-Control: public, max-age=604800\n'
    '/fonts/*\n'
    '  Cache-Control: public, max-age=31536000, immutable\n', encoding='utf-8')
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
# посадочные страницы: по одной на «экзамен × уровень × язык» (см. генератор выше)
landing_written = []
for _eid, _ex, _lv, _tests in landing_pairs():
    for _lang in LANDING_LANGS:
        _u = landing_url(_lang, _eid, _lv)
        _dir = docs / _u.rstrip('/')
        _dir.mkdir(parents=True, exist_ok=True)
        (_dir / 'index.html').write_text(landing_page(_lang, _eid, _ex, _lv, _tests, _base), encoding='utf-8')
        landing_written.append(_u)
# страницы-ответы на частые вопросы (только ru, см. info_pages)
for _u, _title, _desc, _body in info_pages():
    _dir = docs / _u.rstrip('/')
    _dir.mkdir(parents=True, exist_ok=True)
    (_dir / 'index.html').write_text(info_page_html(_u, _title, _desc, _body, _base), encoding='utf-8')
    landing_written.append(_u)

if _base:
    (docs / 'robots.txt').write_text('User-agent: *\nAllow: /\nDisallow: /demo/\nSitemap: ' + _base + 'sitemap.xml\n', encoding='utf-8')
    import datetime
    _d = datetime.date.today().isoformat()
    _urls = ''.join('<url><loc>%s</loc><lastmod>%s</lastmod></url>' % (_base + u, _d) for u in ['', 'privacy/', 'review/'] + landing_written)
    (docs / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + _urls + '</urlset>\n', encoding='utf-8')
put_audio(docs / 'audio')
put_fonts(docs / 'fonts')
# страница «Какие данные мы собираем» (RU/KK); ссылка — в подвале приложения и в форме обратной связи
(docs / 'privacy').mkdir(exist_ok=True)
shutil.copyfile(src / 'privacy' / 'index.html', docs / 'privacy' / 'index.html')

# ---- дизайн сайта (утверждён владельцем 31.10.2026): слой src/design поверх styles.css и LANDING_CSS ----
# Стили стоят сразу за стилями страницы, design.js достраивает шапку, свёрнутые подробности и порядок блоков после отрисовки.
# На статических страницах «мок-тест» заменяется при сборке, в приложении — в design.js (строки данных и словаря прежние).
_dz = docs / 'design'; shutil.rmtree(_dz, ignore_errors=True); shutil.copytree(src / 'design', _dz)
_DZ_LINKS = ''.join('<link rel="stylesheet" href="/design/' + f + '">' for f in ('fonts/fonts.css', 'base.css', 'd1.css'))
_DZ_WORDS = (('Мок-тесты', 'Пробные тесты'), ('мок-тесты', 'пробные тесты'), ('Мок-тестов', 'Пробных тестов'), ('мок-тестов', 'пробных тестов'),
             ('Мок-теста', 'Пробного теста'), ('мок-теста', 'пробного теста'), ('Мок-тест', 'Пробный тест'), ('мок-тест', 'пробный тест'))
def _dress(p):
    h = p.read_text(encoding='utf-8')
    h = h.replace('<html lang=', '<html data-design="d1" lang=', 1).replace('content="#0e6e86"', 'content="#34497a"')
    if '<div class="wrap">' in h: h = h.replace('<div class="wrap">', _DZ_LINKS + '<div class="wrap">', 1)
    else:
        h = h.replace('<body><main>', '<body>' + _DZ_LINKS + '<main>', 1)
        for x, y in _DZ_WORDS: h = h.replace(x, y)
        # название экзамена в видимом тексте: мало текста — Qazaq Resmi Test, много — QRT. <title>, описание и разметка поиска не меняются: QazResmiTest и Казресмитест там ищут
        _head, _sep, _body = h.partition('<body>')
        _parts = re.split(r'(<script\b.*?</script>)', _body, flags=re.S)
        def _ex(m):
            t = m.group(1)
            if 'QazResmiTest' not in t: return m.group(0)
            return '>' + t.replace('QazResmiTest', 'Qazaq Resmi Test' if len(t) <= 60 else 'QRT') + '<'
        h = _head + _sep + ''.join(x if x.startswith('<script') else re.sub(r'>([^<]+)<', _ex, x) for x in _parts)
    i = h.rindex('</body>'); h = h[:i] + '<script src="/design/design.js"></script>' + h[i:]
    p.write_text(h, encoding='utf-8')
for _p in [docs / 'index.html', docs / '404.html'] + [pathlib.Path(x) for pat in ('ru', 'kk') for x in glob.glob(str(docs / pat / '**' / 'index.html'), recursive=True)]:
    _dress(_p)

# ---- лаборатория (рабочая копия приватного репозитория) ----
lab = root / 'lab-site'; lab.mkdir(exist_ok=True)
(lab / 'index.html').write_text(full('lab'), encoding='utf-8')
(lab / 'robots.txt').write_text('User-agent: *\nDisallow: /\n', encoding='utf-8')
# lab-site — рабочая копия приватного репозитория: без этого файла wrangler выкладывает на Cloudflare и папку .git (найдено 16.09.2026)
(lab / '.assetsignore').write_text('.git\n.gitignore\n.assetsignore\n', encoding='utf-8')
for ico in ('favicon.svg', 'favicon.ico', 'favicon-48.png', 'favicon-192.png', 'apple-touch-icon.png'):
    if (docs / ico).exists(): shutil.copyfile(docs / ico, lab / ico)
put_audio(lab / 'audio')
put_fonts(lab / 'fonts')
# статистика сайта: страница читает /api/stats (tools/lab-deploy/worker.js); вопросы и варианты — из файлов тестов,
# вставленных как есть (каждый файл — KZ.tests.push({...}))
_tests_js = '\n'.join(read(f) for f in sorted(glob.glob(str(src / 'data' / 'tests' / '*.js'))))
assert '</script' not in _tests_js.lower(), 'в данных тестов есть </script> — страница статистики сломается'
(lab / 'stats').mkdir(exist_ok=True)
(lab / 'stats' / 'index.html').write_text(read(src / 'stats' / 'index.html').replace('/*TESTS*/', _tests_js), encoding='utf-8')

# новая версия публичного сайта внутри лаборатории — на оценку владельцу до выкладки (29.10.2026): переключатель
# «Обучение · Новый сайт» добавляет воркер лаборатории (tools/lab-deploy/worker.js), сама обучалка не меняется.
# Аудио и шрифты у сборок одинаковые, поэтому берутся из лаборатории, а не копируются второй раз.
shutil.rmtree(lab / '_site', ignore_errors=True)
shutil.copytree(docs, lab / '_site', ignore=lambda d, names: [n for n in names if d == str(docs) and n in ('audio', 'fonts', 'CNAME', '_headers')])

kb = lambda p: p.stat().st_size // 1024
print('built: docs/index.html (%d KB, сайт — только мок-тесты), lab-site/index.html (%d KB, лаборатория: +курс%s), dist/index.html (%d KB), dist/artifact.html'
      % (kb(docs / 'index.html'), kb(lab / 'index.html'), ' +платное' if paid_data else '', kb(root / 'dist' / 'index.html')))
