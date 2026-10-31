# 3D-клипы для роликов Qazaq Trainer (вид сайта, 31.10.2026). Запуск:
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/social/blender/fx3d.py -- count|mark [кадров_для_теста]
# count — отсчёт 4-3-2-1 в тающем кольце (4 с), mark — знак қошқар мүйіз, завитки прорисовываются (3 с).
# Клипы одни на все ролики: соцсети/_3d/*.mov (ProRes 4444, прозрачный фон, вне git: 46 МБ, пересобираются этим скриптом), reels.py кладёт их поверх кадров.
import bpy, math, pathlib, re, sys
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parents[3] / 'соцсети' / '_3d'; OUT.mkdir(parents=True, exist_ok=True)
FONT = str(HERE.parent / 'fonts' / 'Geologica-800.ttf')
args = sys.argv[sys.argv.index('--') + 1:]
what = args[0]; limit = int(args[1]) if len(args) > 1 else None
FPS = 30
def lin(c): return ((c + .055) / 1.055) ** 2.4 if c > .04045 else c / 12.92
def rgb(h): return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5)) + (1,)
def mat(name, h, rough=.32):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = rgb(h); b.inputs['Roughness'].default_value = rough
    return m

def scene(size, frames, ortho):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    global SUN, WHITE
    SUN, WHITE = mat('sun', '#f0d48a'), mat('white', '#fcfcfd', .4)
    s = bpy.context.scene
    s.render.engine = 'BLENDER_EEVEE'
    s.render.resolution_x = s.render.resolution_y = size; s.render.fps = FPS
    s.frame_start, s.frame_end = 1, (min(limit, frames) if limit else frames)
    s.render.film_transparent = True; s.view_settings.view_transform = 'Standard'
    s.eevee.taa_render_samples = 16
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = ortho
    co = bpy.data.objects.new('cam', cam); s.collection.objects.link(co); s.camera = co
    co.location = (0, 0, 6)
    w = bpy.data.worlds.new('w'); s.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1); w.node_tree.nodes['Background'].inputs[1].default_value = .68
    for loc, rot, e in (((3, -3, 6), (.5, .35, 0), 1.05), ((-4, 2, 3), (-.5, -.8, 0), .15)):
        l = bpy.data.lights.new('l', 'SUN'); l.energy = e
        o = bpy.data.objects.new('l', l); s.collection.objects.link(o); o.location = loc; o.rotation_euler = rot
    return s

def output(s, name):
    r = s.render; r.image_settings.media_type = 'VIDEO'; r.image_settings.file_format = 'FFMPEG'
    r.ffmpeg.format = 'QUICKTIME'; r.ffmpeg.codec = 'PRORES'; r.ffmpeg.ffmpeg_prores_profile = '4444'
    r.image_settings.color_mode = 'RGBA'; r.filepath = str(OUT / name)
    bpy.ops.render.render(animation=True)

def key(o, path, frame, val, interp='BEZIER'):
    setattr(o, path, val); o.keyframe_insert(data_path=path, frame=frame)

def count():
    s = scene(640, 120, 3.1)
    # кольцо-таймер: тает за 4 с
    # окружность разомкнута: у замкнутой кривой Blender игнорирует bevel_factor. Пять точек, начало сверху, идёт по часовой
    c = bpy.data.curves.new('ring', 'CURVE'); c.dimensions = '3D'; c.bevel_depth = .07; c.bevel_resolution = 6; c.use_fill_caps = True; c.resolution_u = 32
    c.bevel_factor_mapping_end = 'SPLINE'; c.materials.append(SUN)
    sp = c.splines.new('BEZIER'); sp.bezier_points.add(4); R, K = 1.28, 1.28 * .5523
    for j, a in enumerate((90, 0, -90, -180, -270)):
        t = math.radians(a); pt = sp.bezier_points[j]; x, y = R * math.cos(t), R * math.sin(t); dx, dy = math.sin(t) * K, -math.cos(t) * K
        pt.co = (x, y, 0); pt.handle_right = (x + dx, y + dy, 0); pt.handle_left = (x - dx, y - dy, 0)
    ring = bpy.data.objects.new('ring', c); s.collection.objects.link(ring)
    pref = bpy.context.preferences.edit; pref.keyframe_new_interpolation_type = 'LINEAR'   # таймер тает ровно
    c.bevel_factor_end = 1; c.keyframe_insert('bevel_factor_end', frame=1)
    c.bevel_factor_end = 0.02; c.keyframe_insert('bevel_factor_end', frame=120)
    pref.keyframe_new_interpolation_type = 'BEZIER'
    for i, d in enumerate('4321'):
        cu = bpy.data.curves.new('d' + d, 'FONT'); cu.body = d; cu.font = bpy.data.fonts.load(FONT)
        cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.size = 2.1; cu.extrude = .16; cu.bevel_depth = .018; cu.bevel_resolution = 3
        cu.materials.append(WHITE)
        o = bpy.data.objects.new('d' + d, cu); s.collection.objects.link(o)
        f0 = 1 + i * 30
        o.scale = (0, 0, 0); o.keyframe_insert('scale', frame=max(f0 - 1, 0))
        for f, sc, ry in ((f0, .35, -1.0), (f0 + 5, 1.14, -.42), (f0 + 9, 1, -.3), (f0 + 26, 1, .3), (f0 + 29, .2, .9)):
            o.scale = (sc, sc, sc); o.keyframe_insert('scale', frame=f)
            o.rotation_euler = (.12, ry, 0); o.keyframe_insert('rotation_euler', frame=f)
        o.scale = (0, 0, 0); o.keyframe_insert('scale', frame=f0 + 30)
    output(s, 'count.mov')

def path_points():
    """SVG-контур знака (M V H L C и строчные) в кубические сегменты."""
    d = (HERE / 'mark_path.txt').read_text()
    toks = re.findall(r'[MmLlHhVvCc]|-?\d*\.?\d+', d)
    subs, cur, x, y, i, cmd = [], [], 0., 0., 0, None
    while i < len(toks):
        if re.match(r'[A-Za-z]', toks[i]): cmd = toks[i]; i += 1
        def num():
            nonlocal i
            v = float(toks[i]); i += 1; return v
        if cmd in 'Mm':
            nx, ny = num(), num()
            x, y = (nx, ny) if cmd == 'M' else (x + nx, y + ny)
            if cur: subs.append(cur)
            cur = [(x, y)]; cmd = 'L' if cmd == 'M' else 'l'
        elif cmd in 'Ll':
            nx, ny = num(), num(); x, y = (nx, ny) if cmd == 'L' else (x + nx, y + ny); cur.append(('l', x, y))
        elif cmd in 'Hh':
            nx = num(); x = nx if cmd == 'H' else x + nx; cur.append(('l', x, y))
        elif cmd in 'Vv':
            ny = num(); y = ny if cmd == 'V' else y + ny; cur.append(('l', x, y))
        elif cmd in 'Cc':
            p = [num() for _ in range(6)]
            if cmd == 'c': p = [p[0] + x, p[1] + y, p[2] + x, p[3] + y, p[4] + x, p[5] + y]
            cur.append(('c', *p)); x, y = p[4], p[5]
    if cur: subs.append(cur)
    return subs

def mark():
    s = scene(640, 90, 2.5)
    cu = bpy.data.curves.new('mark', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = .075; cu.bevel_resolution = 6; cu.use_fill_caps = True
    cu.bevel_factor_mapping_end = 'SPLINE'; cu.resolution_u = 24; cu.materials.append(SUN)
    P = lambda x, y: ((x - 50) * .02, (50 - y) * .02, 0)
    for sub in path_points():
        sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(sub) - 1)
        pts = sp.bezier_points; pts[0].co = P(*sub[0]); pts[0].handle_left = pts[0].handle_right = pts[0].co
        for j, seg in enumerate(sub[1:], 1):
            b = pts[j]
            if seg[0] == 'l':
                b.co = P(seg[1], seg[2]); b.handle_left = b.handle_right = b.co
            else:
                pts[j - 1].handle_right = P(seg[1], seg[2]); b.handle_left = P(seg[3], seg[4]); b.co = P(seg[5], seg[6]); b.handle_right = b.co
    o = bpy.data.objects.new('mark', cu); s.collection.objects.link(o)
    cu.bevel_factor_end = 0; cu.keyframe_insert('bevel_factor_end', frame=1)
    cu.bevel_factor_end = 1; cu.keyframe_insert('bevel_factor_end', frame=24)
    for f, ry in ((1, -.55), (28, .1), (40, -.05), (60, .06), (90, -.06)):
        o.rotation_euler = (0, ry, 0); o.keyframe_insert('rotation_euler', frame=f)
    output(s, 'mark.mov')

{'count': count, 'mark': mark}[what]()
print('готово', what)
