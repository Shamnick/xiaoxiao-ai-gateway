# -*- coding: utf-8 -*-
"""用户中心布局/像素一致性对比（线上 vs 本地镜像）"""
import json, sys, pathlib
import numpy as np
from PIL import Image

OUT = pathlib.Path(__file__).resolve().parent.parent / 'logs/visual-user'

def load(n): return json.loads((OUT / (n + '.layout.json')).read_text())

def diff(a, b, tol=1.0, label=''):
    na, nb = a['nodes'], b['nodes']
    print('=' * 66)
    print('%s  节点 %d vs %d | 页高 %s vs %s' % (label, len(na), len(nb), a['docHeight'], b['docHeight']))
    structural, geo = [], []
    for i in range(min(len(na), len(nb))):
        x, y = na[i], nb[i]
        if (x['tag'], x['cls'], x['id']) != (y['tag'], y['cls'], y['id']):
            structural.append((i, x, y)); continue
        d = max(abs(x['x'] - y['x']), abs(x['y'] - y['y']), abs(x['w'] - y['w']), abs(x['h'] - y['h']))
        if d > tol: geo.append((d, x, y))
    geo.sort(key=lambda t: -t[0])
    print('结构差异: %d  几何差异(>%spx): %d' % (len(structural), tol, len(geo)))
    for i, x, y in structural[:6]:
        print('  [结构] #%s 线上=%s.%s#%s  本地=%s.%s#%s' % (i, x['tag'], x['cls'][:34], x['id'], y['tag'], y['cls'][:34], y['id']))
    for d, x, y in geo[:6]:
        print('  [几何 Δ%.1f] %s.%s#%s  线上(%s,%s,%sx%s) 本地(%s,%s,%sx%s)' % (d, x['tag'], x['cls'][:30], x['id'], x['x'], x['y'], x['w'], x['h'], y['x'], y['y'], y['w'], y['h']))
    return len(structural) + len(geo)

def pixel(a, b, label):
    ia = Image.open(OUT / (a + '-full.png')).convert('RGB')
    ib = Image.open(OUT / (b + '-full.png')).convert('RGB')
    if ia.size != ib.size:
        print('%-12s 尺寸不同 %s vs %s' % (label, ia.size, ib.size)); return 1
    na, nb = np.asarray(ia, np.int16), np.asarray(ib, np.int16)
    d = np.abs(na - nb).max(axis=2)
    total = d.size
    o8, o32 = int((d > 8).sum()), int((d > 32).sum())
    print('%-12s %s 差异>8: %d (%.4f%%)  >32: %d (%.5f%%)  max=%d' % (label, ia.size, o8, o8*100.0/total, o32, o32*100.0/total, int(d.max())))
    return 0 if o32 * 100.0 / total < 0.05 else 1

bad = 0
for pair in [('subscription', '无限额度订阅'), ('dashboard', '控制台首页')]:
    a, b, label = 'remote-' + pair[0], 'local-' + pair[0], pair[1]
    bad += diff(load(a), load(b), label=label)
    bad += pixel(a, b, label)
print('=' * 66)
print('总差异项：%d' % bad)
sys.exit(0 if bad == 0 else 2)
