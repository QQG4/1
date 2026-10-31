#!/opt/homebrew/Cellar/ocrmypdf/17.10.0/libexec/bin/python
"""TTF для кадров роликов из шрифтов сайта (src/design/fonts/*.woff2): PIL не читает woff2, а там подмножества и
переменный вес. Распаковка Brotli через zlib в node, вес фиксируется instancer, подмножества сливаются Merger.
Без скачиваний; запускать раз, результат лежит в tools/social/fonts/ (OFL). Python с fontTools — из ocrmypdf."""
import json, pathlib, subprocess, sys, tempfile, types
ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC, OUT = ROOT / 'src/design/fonts', ROOT / 'tools/social/fonts'
def _brotli(data):
    return subprocess.run(['node', '-e', "const z=require('zlib');let c=[];process.stdin.on('data',d=>c.push(d)).on('end',()=>process.stdout.write(z.brotliDecompressSync(Buffer.concat(c))))"],
                          input=data, capture_output=True, check=True).stdout
sys.modules['brotli'] = types.SimpleNamespace(decompress=_brotli, error=Exception)
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.merge import Merger, Options
SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']
for fam, name, weights in (('geologica', 'Geologica', (700, 800)), ('golos-text', 'GolosText', (400, 600))):
    for w in weights:
        parts = []
        with tempfile.TemporaryDirectory() as td:
            for s in SUBSETS:
                f = TTFont(SRC / ('%s-%s.woff2' % (fam, s)))
                print(fam, s, 'оси:', [a.axisTag for a in f['fvar'].axes] if 'fvar' in f else 'нет')
                if 'fvar' in f:
                    axes = {a.axisTag: (w if a.axisTag == 'wght' else a.defaultValue) for a in f['fvar'].axes}
                    f = instancer.instantiateVariableFont(f, axes)
                f.flavor = None
                for t in ('GSUB', 'GPOS', 'GDEF', 'STAT', 'HVAR', 'MVAR', 'avar'):
                    if t in f: del f[t]
                p = pathlib.Path(td) / (s + '.ttf'); f.save(p); parts.append(str(p))
            o = Options(); o.drop_tables = ['DSIG', 'GSUB', 'GPOS', 'GDEF', 'gasp', 'hdmx', 'VDMX', 'LTSH', 'vhea', 'vmtx', 'kern']
            m = Merger(options=o).merge(parts)
            out = OUT / ('%s-%d.ttf' % (name, w)); m.save(out)
            cmap = TTFont(out).getBestCmap()
            miss = [c for c in 'әғқңөұүһіӘҒҚҢӨҰҮҺІёЁа-яAz:«»—·?!' if ord(c) not in cmap]
            print(out.name, out.stat().st_size // 1024, 'КБ, глифов', len(cmap), 'нет:', miss)
