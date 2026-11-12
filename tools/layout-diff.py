# -*- coding: utf-8 -*-
"""布局对齐校验：比较原站与本地镜像每个元素的几何盒模型。"""
import json, sys, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / 'logs/visual'

def load(name):
    return json.loads((OUT / (name + '.layout.json')).read_text())

def diff(a, b, tol=1.0, label=''):
    na, nb = a['nodes'], b['nodes']
    print('=' * 62)
    print('%s  节点 %d vs %d | 视口 %s vs %s | 页高 %s vs %s' % (
        label, len(na), len(nb), a['viewport'], b['viewport'], a['docHeight'], b['docHeight']))
    diffs, structural = [], []
    n = min(len(na), len(nb))
    for i in range(n):
        x, y = na[i], nb[i]
        if (x['tag'], x['cls'], x['id']) != (y['tag'], y['cls'], y['id']):
            structural.append((i, x, y))
            continue
        d = max(abs(x['x'] - y['x']), abs(x['y'] - y['y']), abs(x['w'] - y['w']), abs(x['h'] - y['h']))
        if d > tol:
            diffs.append((d, x, y))
    if len(na) != len(nb):
        tail = na[n:] if len(na) > len(nb) else nb[n:]
        for x in tail:
            structural.append(('tail', x, None))
    diffs.sort(key=lambda t: -t[0])
    print('结构差异: %d  几何差异(>%spx): %d' % (len(structural), tol, len(diffs)))
    for i, x, y in structural[:8]:
        print('  [结构] #%s 原站=%s.%s#%s (%sx%s @%s,%s)  本地=%s' % (
            i, x['tag'], x['cls'][:40], x['id'], x['w'], x['h'], x['x'], x['y'],
            (y['tag'] + '.' + y['cls'][:40] + '#' + y['id']) if y else '缺失'))
    for d, x, y in diffs[:8]:
        print('  [几何 Δ%.1f] %s.%s#%s  原站(%s,%s,%sx%s)  本地(%s,%s,%sx%s)' % (
            d, x['tag'], x['cls'][:44], x['id'], x['x'], x['y'], x['w'], x['h'], y['x'], y['y'], y['w'], y['h']))
    return len(structural) + len(diffs)

if __name__ == '__main__':
    bad = 0
    bad += diff(load('remote-home'), load('local-home'), label='首页 /')
    bad += diff(load('remote-models'), load('local-models'), label='模型广场 /?page=models')
    print('=' * 62)
    print('总差异项：%d' % bad)
    sys.exit(0 if bad == 0 else 2)
