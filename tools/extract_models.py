# -*- coding: utf-8 -*-
"""从原始快照中提取模型卡片数据，并用重建模板做 round-trip 校验（必须 100% 字节相等）。"""
import re, html, json, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'

def esc(t):
    return html.escape(t, quote=False)

def attr(t):
    return html.escape(t, quote=True)

CARD_RE = re.compile(r'<article class="model-card[^"]*"[^>]*>.*?</article>', re.S)

def parse_card(raw):
    d = {}
    m = re.match(r'<article class="([^"]*)" data-brand="([^"]*)">', raw)
    classes, brand = m.group(1), m.group(2)
    d['brand'] = brand
    d['is_new'] = 'is-new' in classes.split()
    d['has_variants'] = 'has-variants' in classes.split()
    m = re.search(r'data-variants="([^"]*)"', raw)
    d['variants'] = json.loads(html.unescape(m.group(1))) if m else []
    d['name'] = re.search(r'<h3 class="model-name">(.*?)</h3>', raw, re.S).group(1)
    d['logo'] = bool(re.search(r'class="model-logo[^"]*has-img"', raw))
    d['logo_src'] = (re.search(r'<img src="([^"]+)"', raw) or [None, ''])[1]
    tags = re.findall(r'<span class="model-tag([^"]*)">(.*?)</span>', raw, re.S)
    d['tags'] = [{'cls': c.strip(), 'text': t} for c, t in tags]
    d['desc'] = re.search(r'<p class="model-desc">(.*?)</p>', raw, re.S).group(1)
    foot = re.search(r'<div class="model-foot([^"]*)">', raw).group(1).strip()
    d['has_refill'] = 'has-refill' in foot
    d['vendor'] = re.search(r'<span class="model-vendor">(.*?)</span>', raw, re.S).group(1)
    pm = re.search(r'<span class="model-price"([^>]*)>(.*?)</span>', raw, re.S)
    d['price_attrs'] = pm.group(1)
    d['price'] = pm.group(2)
    rm = re.search(r'<a class="model-refill"([^>]*)>(.*?)</a>', raw, re.S)
    d['refill_attrs'] = rm.group(1) if rm else None
    d['refill_html'] = rm.group(2) if rm else None
    return d

def render_card(d, refill_url='https://a10.yutiankejiai.com/client/'):
    cls = 'model-card' + (' is-new' if d['is_new'] else '') + (' has-variants' if d.get('has_variants') else '')
    out = '<article class="%s" data-brand="%s">' % (cls, attr(d['brand']))
    if d.get('has_variants'):
        out += 'data-variants="%s"' % attr(json.dumps(d['variants'], ensure_ascii=False, separators=(',', ':')))
    if d['is_new']:
        out += '<span class="model-badge-new">上新</span>'
    out += '<div class="model-head"><span class="model-logo model-logo--%s%s">' % (attr(d['brand']), ' has-img' if d['logo'] else '')
    if d['logo']:
        out += '<img src="%s" alt="%s" width="22" height="22" loading="lazy" decoding="async">' % (d['logo_src'], attr(d['brand']))
    out += '</span><div class="model-head-main"><div class="model-name-row"><h3 class="model-name">%s</h3>' % d['name']
    out += '<button type="button" class="model-copy" data-model="%s" data-label="复制" aria-label="复制模型名 %s">复制</button>' % (attr(d['name']), attr(d['name']))
    out += '</div></div></div><div class="model-tags">'
    for t in d['tags']:
        out += '<span class="model-tag%s">%s</span>' % ((' ' + t['cls']) if t['cls'] else '', t['text'])
    out += '</div><p class="model-desc">%s</p>' % d['desc']
    out += '<div class="model-foot%s">' % (' has-refill' if d['has_refill'] else '')
    out += '<span class="model-vendor">%s</span>' % d['vendor']
    out += '<span class="model-price"%s>%s</span>' % (d['price_attrs'], d['price'])
    if d['refill_html'] is not None:
        at = d['refill_attrs'].replace('https://a10.yutiankejiai.com/client/', refill_url)
        out += '<a class="model-refill"%s>%s</a>' % (at, d['refill_html'])
    out += '</div></article>'
    return out

def main():
    s = (SRC / 'pages/models.html').read_text(encoding='utf-8')
    raws = CARD_RE.findall(s)
    parsed = [parse_card(r) for r in raws]
    bad = 0
    for r, d in zip(raws, parsed):
        rebuilt = render_card(d)
        if rebuilt != r:
            bad += 1
            if bad <= 3:
                print('MISMATCH', d['name'])
                for i in range(min(len(r), len(rebuilt))):
                    if r[i] != rebuilt[i]:
                        print('  at', i, repr(r[i-60:i+80]), '\n  vs ', repr(rebuilt[i-60:i+80]))
                        break
                print('  len', len(r), len(rebuilt))
    print('cards=%d  roundtrip_bad=%d' % (len(raws), bad))
    out = {'models': parsed, 'raw_count': len(raws)}
    (ROOT / 'data').mkdir(exist_ok=True)
    (ROOT / 'data/seed-models.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print('written data/seed-models.json')

if __name__ == '__main__':
    main()
