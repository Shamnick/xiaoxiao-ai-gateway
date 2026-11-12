# -*- coding: utf-8 -*-
"""像素级对比：原站 vs 本地镜像（canvas/宠物/打字机等随机层已在采样时隐藏）"""
import sys, pathlib
from PIL import Image, ImageChops
import numpy as np

OUT = pathlib.Path(__file__).resolve().parent.parent / 'logs/visual'
PAIRS = [('remote-home', 'local-home', '首页 /'), ('remote-models', 'local-models', '模型广场'), ('remote-terms', 'local-terms', '使用条款')]

bad = 0
for a, b, label in PAIRS:
    ia = Image.open(OUT / (a + '-full.png')).convert('RGB')
    ib = Image.open(OUT / (b + '-full.png')).convert('RGB')
    if ia.size != ib.size:
        print('%s: 尺寸不一致 %s vs %s' % (label, ia.size, ib.size)); bad += 1; continue
    na, nb = np.asarray(ia, dtype=np.int16), np.asarray(ib, dtype=np.int16)
    d = np.abs(na - nb).max(axis=2)
    total = d.size
    over8 = int((d > 8).sum())
    over32 = int((d > 32).sum())
    print('%-10s %s  像素总 %d  差异>8: %d (%.4f%%)  >32: %d (%.5f%%)  最大 %d'
          % (label, ia.size, total, over8, over8 * 100.0 / total, over32, over32 * 100.0 / total, int(d.max())))
    if over32 * 100.0 / total > 0.05:
        bad += 1
    # 差异热力图
    hm = Image.fromarray((np.clip(d, 0, 255)).astype('uint8'))
    hm.save(OUT / (b + '-diffmask.png'))
print('结论：' + ('一致（无肉眼可见差异）' if bad == 0 else '存在需核查的差异'))
sys.exit(0 if bad == 0 else 2)
