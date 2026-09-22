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
           'vocab': 'Объём лексики', 'exam_page': 'Пробный тест'},
    'kk': {'lang': 'kk', 'kicker_more': 'Басқа деңгейлер', 'what': 'Бұл деңгейде не тексеріледі', 'structure': 'Тест құрылымы',
           'variants': 'Сынақ тест нұсқалары', 'sec': 'Бөлім', 'tasks': 'Тапсырма', 'min': 'Минут', 'total': 'Тестке барлығы',
           'cta': 'Сынақ тестті бастау', 'free': 'Тегін, тіркелусіз, нәтиже тексеруден кейін бірден.',
           'home': 'Барлық емтихан мен деңгей', 'mins': 'мин',
           'note': 'Тапсырмалардың пішімі — тестің жарияланған құрылымы бойынша жасалған жұмыс реконструкциясы, нақты '
                   'интерфейстің көшірмесі емес. Жазылым мен айтылым мұнда критерийлер бойынша өзін-өзі тексерумен бағаланады.',
           'vocab': 'Лексика көлемі', 'exam_page': 'Сынақ тест'},
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
            tests = [x for x in META['tests'] if x['exam'] == eid and x['level'] == lv]
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

def landing_page(lang, eid, ex, lv, tests, base):
    e = _html.escape
    T = L10N[lang]
    lvl = META['levels'].get(lv, {})
    ex_name = ex.get('name', eid)
    lvl_name = _lk(lvl, 'name', lang)
    n = len(tests)
    if lang == 'ru':
        # в заголовок — написание, которым ищут: «казтест» обычной К; официальное ҚАЗТЕСТ остаётся в H1
        alias = 'Казтест' if eid == 'kaztest' else ex_name + ' (Казресмитест)'
        title = f'Пробный {alias} {lv} онлайн: подготовка, {_plural_ru(n, "вариант", "варианта", "вариантов")} бесплатно'
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

    h = ['<!doctype html><html lang="' + T['lang'] + '"><head><meta charset="utf-8">',
         '<meta name="viewport" content="width=device-width,initial-scale=1">',
         '<title>' + e(title) + '</title>',
         '<meta name="description" content="' + e(desc) + '">',
         '<meta name="theme-color" content="#0e6e86">',
         '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">']
    if base:
        h.append('<link rel="canonical" href="' + e(url) + '">')
        for lg in LANDING_LANGS:
            h.append('<link rel="alternate" hreflang="' + lg + '" href="' + e(base + landing_url(lg, eid, lv)) + '">')
        h.append('<link rel="alternate" hreflang="x-default" href="' + e(base + landing_url('ru', eid, lv)) + '">')
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

    start = '/#/test/' + tests[0]['id']
    h.append('<p class="kicker">' + e(ex.get('kicker') or ex_name) + ' · ' + e(lv) + '</p>')
    h.append('<h1>' + e(h1) + '</h1>')
    if _lk(ex, 'tagline', lang): h.append('<p class="lead">' + e(_lk(ex, 'tagline', lang)) + '</p>')
    h.append('<p><a class="cta" href="' + start + '">' + e(T['cta']) + '</a></p>')
    h.append('<p class="lead">' + e(T['free']) + '</p>')

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
    for x in tests:
        nm = _lk(x, 'title', lang) or x['id']
        sm = _lk(x, 'summary', lang)
        h.append('<li><a href="/#/test/' + e(x['id']) + '">' + e(nm) + '</a>' + (' — ' + e(sm) if sm else '') + '</li>')
    h.append('</ol>')

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

def landing_script(lang, eid, lv):
    """Две вещи. (1) Просмотр посадочной страницы уходит в статистику событием pageview с путём lp/<lang>/<exam>/<level>:
       иначе заходы из поиска не видны вовсе, пока человек не нажмёт кнопку. (2) Ссылки внутрь приложения получают
       utm-метки и ?ref=<домен источника>: при переходе /ru/... → /#/test/... document.referrer становится нашим
       собственным доменом, и без этого все заходы из поиска и из Telegram записывались бы как прямые."""
    ev = site_cfg.get('events') or ''
    return ('<script>(function(){var sp=new URLSearchParams(location.search),q=new URLSearchParams(),ref="";'
            'try{ref=document.referrer?new URL(document.referrer).hostname:""}catch(e){}'
            'if(ref===location.hostname)ref="";'
            '["utm_source","utm_medium","utm_campaign"].forEach(function(k){if(sp.get(k))q.set(k,sp.get(k).slice(0,40))});'
            'if(ref)q.set("ref",ref.replace(/^www\\./,"").slice(0,80));'
            'var qs=q.toString();if(qs)document.querySelectorAll(\'a[href^="/#"]\').forEach(function(a){a.href="/?"+qs+a.getAttribute("href").slice(1)});'
            + ('var u=' + json.dumps(ev) + ';if(u&&navigator.sendBeacon){var p={path:' + json.dumps('lp/' + lang + '/' + eid + '/' + lv.lower()) + '};'
               'if(ref)p.ref=ref.replace(/^www\\./,"").slice(0,80);var m=["utm_source","utm_medium","utm_campaign"].map(function(k){return(sp.get(k)||"").slice(0,40)});'
               'if(m.join(""))p.utm=m.join("/");'
               'var sid=Math.random().toString(36).slice(2,12),send=function(n,pp){try{navigator.sendBeacon(u,new Blob([JSON.stringify({e:n,sid:sid,lang:' + json.dumps(lang) + ',ts:Date.now(),p:pp})],{type:"text/plain;charset=UTF-8"}))}catch(e){}};'
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
    out.append('<a href="/kk/' + pairs[0][0] + '/' + pairs[0][2].lower() + '/" hreflang="kk">Қазақша</a>')
    out.append('</nav>')
    return ''.join(out)


app = read(src / 'i18n.js') + '\n' + read(src / 'app.js') + '\n' + read(src / 'course.js') if (src / 'i18n.js').exists() else read(src / 'app.js') + '\n' + read(src / 'course.js')
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
    'site': 'Казтест и QazResmiTest онлайн — бесплатные пробные тесты A1–C2 | Qazaq Trainer',
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
        h += ('<link rel="icon" href="favicon.svg" type="image/svg+xml">'
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
    print('docs/quiz.json: %d вопросов' % len(META['quiz']))
def _tests_count_ru():
    """«27 мок-тестов» для анкеты эксперта: число файлов в src/data/tests, чтобы подпись не устаревала при добавлении вариантов."""
    n = len(glob.glob(str(src / 'data' / 'tests' / '*.js'))); d, h = n % 10, n % 100
    return f"{n} " + ('мок-тест' if d == 1 and h != 11 else 'мок-теста' if 2 <= d <= 4 and not 12 <= h <= 14 else 'мок-тестов')
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

# ---- лаборатория (рабочая копия приватного репозитория) ----
lab = root / 'lab-site'; lab.mkdir(exist_ok=True)
(lab / 'index.html').write_text(full('lab'), encoding='utf-8')
(lab / 'robots.txt').write_text('User-agent: *\nDisallow: /\n', encoding='utf-8')
# lab-site — рабочая копия приватного репозитория: без этого файла wrangler выкладывает на Cloudflare и папку .git (найдено 16.09.2026)
(lab / '.assetsignore').write_text('.git\n.gitignore\n.assetsignore\n', encoding='utf-8')
for ico in ('favicon.svg', 'apple-touch-icon.png'):
    if (docs / ico).exists(): shutil.copyfile(docs / ico, lab / ico)
put_audio(lab / 'audio')
put_fonts(lab / 'fonts')
# статистика сайта: страница читает /api/stats (tools/lab-deploy/worker.js); вопросы и варианты — из файлов тестов,
# вставленных как есть (каждый файл — KZ.tests.push({...}))
_tests_js = '\n'.join(read(f) for f in sorted(glob.glob(str(src / 'data' / 'tests' / '*.js'))))
assert '</script' not in _tests_js.lower(), 'в данных тестов есть </script> — страница статистики сломается'
(lab / 'stats').mkdir(exist_ok=True)
(lab / 'stats' / 'index.html').write_text(read(src / 'stats' / 'index.html').replace('/*TESTS*/', _tests_js), encoding='utf-8')

kb = lambda p: p.stat().st_size // 1024
print('built: docs/index.html (%d KB, сайт — только мок-тесты), lab-site/index.html (%d KB, лаборатория: +курс%s), dist/index.html (%d KB), dist/artifact.html'
      % (kb(docs / 'index.html'), kb(lab / 'index.html'), ' +платное' if paid_data else '', kb(root / 'dist' / 'index.html')))
