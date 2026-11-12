"""Человечек для прокрутки в тесте (12.11.2026): тот же герой, что в сценах qt_*, но один, без плиты.
12 кадров: 0-7 цикл шага, 8 стойка, 9-11 поднимает руку. Кадры собирает в ленту make_walker.py.

    Blender -b --factory-startup --python tools/social/blender/walker.py -- --draft --out ПАПКА
Библиотека кубиков лежит в проекте «Коке» (vox_kit.py, vox_scenes.py), путь ниже.
"""
import math
import os
import sys

KIT = "/Users/kkg/Desktop/Additional projects/Коке/05 Видео/graphics/blender"
os.environ["VOX_NO_RUN"] = "1"
sys.path.insert(0, KIT)
import vox_kit as V  # noqa: E402
import vox_scenes as VS  # noqa: E402
import felt_kit as K  # noqa: E402

N = 12


def build(o):
    VS.qt_palette()
    return {"p": V.person("man", "man", (0, 0), shirt="#5b78b8", pants="ink")}


def pose(S, t, f):
    p, i = S["p"], f - 1
    p["root"].location.z = 0.0
    if i < 8:                                   # шаг на месте лицом к зрителю: ноги по очереди уходят наружу, руки в противоход
        a = math.sin(2 * math.pi * i / 8)
        p["root"].location.z = 0.07 * abs(a)
        V.stride(p, "l", 17 * max(a, 0)); V.stride(p, "r", -17 * max(-a, 0))
        V.swing(p, "l", 6 + 22 * max(-a, 0)); V.swing(p, "r", -(6 + 22 * max(a, 0)))
    else:
        V.stride(p, "l", 0); V.stride(p, "r", 0)
        V.swing(p, "l", 5)
        k = [0.0, 0.45, 0.85, 1.0][i - 8]       # стойка, затем рука вверх
        V.swing(p, "r", -(5 + 145 * k))
        p["root"].location.z = 0.1 * k


V.run("walker", build, pose, N / K.FPS)
