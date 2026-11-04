#!/usr/bin/env python3
"""Квизы «Проверь себя» из вопросов мок-тестов (03.11.2026: владелец попросил ещё роликов в новом виде).

Запуск: python3 tools/social/quiz_from_tests.py [число=14] [--out=../соцсети/квизы-тесты]
→ <out>/сценарии.json для reels.py (потом `reels.py <out>/сценарии.json --check`, сборка с --3d).

Казахский берётся только из данных тестов: предложение с пропуском, варианты, ключ. Своего казахского текста нет,
кроме полной формы ответа в голосе (пропуск, заполненный ключом) — её проверяет kk_check при сборке.
Отбор: короткое предложение с пропуском «…», короткие варианты, пояснение влезает в одну строку. Уровни по кругу
A1 → C1, чтобы в пачке были и простые, и трудные. Тесты сами вопросы не меняют; источник — поле source."""
import json, pathlib, re, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
DUMP = r'''
const fs=require('fs'),vm=require('vm');const KZ={tests:[]};const ctx={KZ,window:{KZ}};vm.createContext(ctx);
const dir=process.argv[2];for(const f of fs.readdirSync(dir).sort())if(f.endsWith('.js'))vm.runInContext(fs.readFileSync(dir+'/'+f,'utf8'),ctx);
const out=[];for(const t of KZ.tests){if(t.block)continue;for(const s of t.sections||[])for(const q of s.questions||[])
 if(!s.passage&&!s.script)out.push({test:t.id,level:t.level,id:q.id,text:q.text,options:q.options,answer:q.answer,explain:q.explain||''})}
console.log(JSON.stringify(out));'''
# Задание в конце вопроса («Дұрыс жалғауды таңдаңыз.») уходит в крючок, на экране остаётся предложение
TASK = re.compile(r'\s*((?:Дұрыс|Көп нүктенің|Сөйлемге|Тәуелдік|Сәйкес)[^.«»]*\.)\s*')
GAP = '…'
LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1']
HOOK_RU = {'A1': 'Уровень A1', 'A2': 'Уровень A2', 'B1': 'Уровень B1', 'B2': 'Уровень B2', 'C1': 'Уровень C1'}

def questions():
    js = pathlib.Path(tempfile.mkdtemp()) / 'dump.js'
    js.write_text(DUMP)
    return json.loads(subprocess.check_output(['node', str(js), str(ROOT / 'src/data/tests')]))

def candidate(q):
    text = q['text'].replace('...', GAP)
    task = TASK.search(text)
    sent = TASK.sub(' ', text).strip()
    m = re.fullmatch(r'(?:[^«»]*:\s*)?«(.+)»\.?', sent)   # «Паронимдер: «Мерейтой өте … өтті».» → само предложение
    if m: sent = m.group(1)
    if sent.count(GAP) != 1 or len(sent) > 70 or '(' in sent: return None
    opts = q['options']
    if len(opts) != 3 or any(len(o) > 18 for o in opts): return None
    key = opts[q['answer']]
    suffix = key.startswith('-')
    if suffix:
        if not re.search(r'\w' + GAP, sent): return None
        word = re.search(r'(\w+)' + GAP, sent).group(1) + key[1:]
        # полную форму берём из пояснения, если она там есть: так голос не склеит форму сам
        if word.lower() not in q['explain'].lower(): return None
        full = re.sub(r'\w+' + GAP, word, sent, count=1)
    else:
        if not re.search(r'(^|\s)' + GAP + r'(\s|[,.!?]|$)', sent): return None
        full = sent.replace(GAP, key)
    note = re.split(r'[.;]\s', q['explain'])[0].strip().rstrip('.')
    note = note.replace(' → ', ', поэтому ')   # стрелки нет в шрифтах роликов (квадраты на экране, 03.11.2026)
    if not note or len(note) > 60 or '—' in note or '→' in note: return None
    if full[-1] not in '.!?': full += '.'
    return dict(q, sent=sent, full=full, suffix=suffix, note=note, task=task.group(1) if task else '')

def scenario(c, n):
    sent, opts = c['sent'], c['options']
    v = {'id': 'тест-%02d-%s' % (n, c['level'].lower()), 'date': 'после 09.11', 'slot': 'Проверь себя', 'type': 'quiz', 'cta': 'S',
         'source': '%s %s' % (c['test'], c['id']),
         'hook': {'kk': 'Дұрыс жалғауды таңдаңыз' if c['suffix'] else 'Қай сөз дұрыс?',
                  'ru': HOOK_RU[c['level']] + (': какое окончание?' if c['suffix'] else ': какое слово?')},
         'q': {'kk': sent, 'ru': 'Что вставить вместо «…»?',
               # окончание голосом с пропуском не прочитать: голос читает задание, предложение видно на экране
               'say': 'Дұрыс жалғауды таңдаңыз.' if c['suffix'] else sent.replace(GAP, '...')},
         'options_lang': 'kk', 'options': opts, 'answer': c['answer'], 'say_answer': c['full'], 'note': c['note'],
         'caption': 'Задание из пробного теста %s уровня %s. Ответ и разбор в конце ролика.' % (
             'Qazaq Resmi Test' if c['test'].startswith('qrt') else 'ҚАЗТЕСТ', c['level'])}
    return v

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    count = int(args[0]) if args else 14
    out = pathlib.Path(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--out=')), str(ROOT.parent / 'соцсети/квизы-тесты')))
    pool = {l: [] for l in LEVELS}
    seen = set()
    for q in questions():
        c = candidate(q)
        rule = tuple(sorted(o.strip('-') for o in c['options'])) if c else None   # одно правило (-да/-де/-те) дважды не берём
        if not c or c['level'] not in pool or c['full'] in seen or rule in seen: continue
        seen.update([c['full'], rule]); pool[c['level']].append(c)
    picked, i = [], 0
    while len(picked) < count and any(pool.values()):
        lv = LEVELS[i % len(LEVELS)]; i += 1
        if pool[lv]: picked.append(pool[lv].pop(0 if i % 2 else -1))   # из начала и конца списка: разные тесты
    out.mkdir(parents=True, exist_ok=True)
    data = {'week': out.name, 'campaign': 'tq1',
            'theme': 'Квизы из вопросов пробных тестов (quiz_from_tests.py, 03.11.2026). Казахский из тестов, источник в поле source.',
            'videos': [scenario(c, n) for n, c in enumerate(picked, 1)]}
    (out / 'сценарии.json').write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print('%d квизов → %s  (по уровням: %s)' % (len(picked), out / 'сценарии.json',
          ', '.join('%s %d' % (l, sum(c['level'] == l for c in picked)) for l in LEVELS)))

if __name__ == '__main__':
    main()
