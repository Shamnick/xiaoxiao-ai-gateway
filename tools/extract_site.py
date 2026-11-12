# -*- coding: utf-8 -*-
"""把 6 个页面切成可管理区块 + 品牌/模型/公告结构化数据，产出 data/seed.json。
要求：用默认数据重建后，每个页面必须与原始快照 100% 字节一致（校验在 rebuild 内做）。"""
import re, json, html, pathlib, hashlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'

PAGES = {
    'home':    'src/home.html',
    'models':  'src/pages/models.html',
    'terms':   'src/pages/terms.html',
    'privacy': 'src/pages/privacy.html',
    'refund':  'src/pages/refund.html',
    'ip':      'src/pages/ip.html',
}

VOID = {'img','br','hr','meta','link','input','source','area','base','col','embed','param','track','wbr'}
TAG_RE = re.compile(r'<(/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(/?)>', re.S)


def find_matching(s, i):
    """s[i:] 以一个开始标签开头，返回该元素结束位置（不含）。"""
    m = TAG_RE.match(s, i)
    tag = m.group(2).lower()
    if tag in VOID or m.group(4) == '/':
        return m.end()
    depth = 1
    pos = m.end()
    for mm in TAG_RE.finditer(s, pos):
        t = mm.group(2).lower()
        if t != tag:
            continue
        if mm.group(1) == '/':
            depth -= 1
            if depth == 0:
                return mm.end()
        elif not mm.group(4) == '/':
            depth += 1
    raise ValueError('unmatched ' + tag)


def top_children(s, start, end):
    """返回 [0, end) 内深度 1 的元素区间列表 [(el_start, el_end)]，跳过注释。"""
    out = []
    i = start
    while i < end:
        if s.startswith('<!--', i):
            j = s.find('-->', i)
            i = (j + 3) if j != -1 else end
            continue
        m = TAG_RE.search(s, i, end)
        if not m:
            break
        if m.group(1) == '/':          # 不该出现的孤立结束标签
            i = m.end()
            continue
        el_end = find_matching(s, m.start())
        out.append((m.start(), el_end))
        i = el_end
    return out


def inner_of(s, a, b):
    m = TAG_RE.match(s, a)
    if m.group(4) == '/' or m.group(2).lower() in VOID:
        return ''
    close = s.rfind('</', a, b)
    return s[m.end():close] if close != -1 else ''


def attr_of(s, a):
    return TAG_RE.match(s, a).group(0)


def block_title(outer):
    for pat in (r'<h1[^>]*>(.*?)</h1>', r'<h2[^>]*>(.*?)</h2>', r'<h3[^>]*>(.*?)</h3>'):
        m = re.search(pat, outer, re.S)
        if m:
            t = re.sub(r'<[^>]+>', '', m.group(1)).strip()
            if t:
                return t[:40]
    return ''


def strip_tags(t):
    return re.sub(r'<[^>]+>', '', t)


def split_page(name, path):
    s = pathlib.Path(path).read_text(encoding='utf-8')
    blocks = []

    # header / footer / 入口弹窗 → 公共区块
    hm = re.search(r'<header id="hd"[^>]*>', s)
    if hm:
        e = find_matching(s, hm.start())
        blocks.append({'key': 'common:header', 'scope': 'common', 'tag': 'header',
                       'attrs': attr_of(s, hm.start()), 'html': inner_of(s, hm.start(), e),
                       'orig_outer': s[hm.start():e],
                       'title': '全站顶栏', 'page': 'common'})
    dm = re.search(r'<dialog id="ytEntry"[^>]*>', s)
    if dm:
        e = find_matching(s, dm.start())
        blocks.append({'key': 'common:entry', 'scope': 'common', 'tag': 'dialog',
                       'attrs': attr_of(s, dm.start()), 'html': inner_of(s, dm.start(), e),
                       'orig_outer': s[dm.start():e],
                       'title': '注册/登录选择弹窗', 'page': 'common'})
    fm = re.search(r'<footer[^>]*>', s)
    if fm:
        e = find_matching(s, fm.start())
        blocks.append({'key': 'common:footer', 'scope': 'common', 'tag': 'footer',
                       'attrs': attr_of(s, fm.start()), 'html': inner_of(s, fm.start(), e),
                       'orig_outer': s[fm.start():e],
                       'title': '全站页脚', 'page': 'common'})

    # main 内容
    mm = re.search(r'<main[^>]*>', s)
    if mm:
        main_end = find_matching(s, mm.start())
        kids = top_children(s, mm.end(), main_end - len('</main>'))
        # 单容器（如 article.legal）时下沉一层
        if len(kids) == 1:
            a, b = kids[0]
            tag = TAG_RE.match(s, a).group(2).lower()
            if tag in ('article', 'div', 'main', 'section'):
                kids = top_children(s, TAG_RE.match(s, a).end(), b - (b - s.rfind('</', a, b)))
        for idx, (a, b) in enumerate(kids):
            outer = s[a:b]
            tag = TAG_RE.match(s, a).group(2).lower()
            key = '%s:main:%d' % (name, idx)
            blocks.append({'key': key, 'scope': 'main', 'tag': tag,
                           'attrs': attr_of(s, a), 'html': inner_of(s, a, b),
                           'orig_outer': outer,
                           'title': (block_title(outer) or strip_tags(outer)[:30].strip() or tag),
                           'page': name})
    return s, blocks


def extract_tabs(s):
    m = re.search(r'<div class="model-tabs" role="tablist">', s)
    e = find_matching(s, m.start())
    inner = inner_of(s, m.start(), e)
    raws = re.findall(r'<button type="button" class="model-tab[^"]*" data-brand-tab="[^"]*">.*?</button>', inner, re.S)
    tabs = []
    for bm in re.finditer(r'<button type="button" class="model-tab([^"]*)" data-brand-tab="([^"]*)">(.*?)</button>', inner, re.S):
        tabs.append({'cls': bm.group(1).strip(), 'id': bm.group(2), 'label': bm.group(3)})
    # 原文顺序是 class 在前还是 type 在前？
    raw_btns = re.findall(r'<button[^>]*data-brand-tab="[^"]*"[^>]*>.*?</button>', inner, re.S)
    prefix = inner.split(raws[0])[0] if raws else ''
    suffix = inner.split(raws[-1])[-1] if raws else ''
    return {'outer_span': (m.start(), e), 'inner': inner, 'raw_first': raw_btns[0] if raw_btns else '',
            'raw_count': len(raw_btns), 'prefix': prefix, 'suffix': suffix}


def extract_grid(s):
    m = re.search(r'<div class="model-grid" id="modelGrid">', s)
    e = find_matching(s, m.start())
    inner = inner_of(s, m.start(), e)
    raws = re.findall(r'<article class="model-card[^"]*"[^>]*>.*?</article>', inner, re.S)
    prefix = inner.split(raws[0])[0] if raws else ''
    suffix = inner.split(raws[-1])[-1] if raws else ''
    return {'outer_span': (m.start(), e), 'inner': inner,
            'prefix': prefix, 'suffix': suffix}


def extract_notice(s):
    m = re.search(r'<dialog id="modelNoticeModal"[^>]*>', s)
    if not m:
        return None
    e = find_matching(s, m.start())
    return {'span': (m.start(), e), 'outer': s[m.start():e]}


def main():
    seed = {'pages': {}, 'blocks': {}}
    originals = {}
    for name, path in PAGES.items():
        s, blocks = split_page(name, path)
        originals[name] = s
        seed['pages'][name] = {'file': path, 'blocks': [b['key'] for b in blocks]}
        for b in blocks:
            seed['blocks'][b['key']] = b

    # 模型页：tabs 与 grid 转模板占位符
    ms = originals['models']
    tabs = extract_tabs(ms)
    grid = extract_grid(ms)
    tb = seed['blocks']['models:main:1'] if 'models:main:1' in seed['blocks'] else None
    # 定位 models-section 区块
    sec_key = None
    for k, v in seed['blocks'].items():
        if v['page'] == 'models' and 'models-section' in v['attrs']:
            sec_key = k
            break
    sec = seed['blocks'][sec_key]
    s_start = ms.find(sec['attrs'])
    sec_end = find_matching(ms, s_start)
    sec_outer = ms[s_start:sec_end]
    g_in = grid['inner']
    t_in = tabs['inner']
    tpl = sec_outer.replace(g_in, '\u0000GRID\u0000', 1).replace(t_in, '\u0000TABS\u0000', 1)
    sec['tpl_outer'] = tpl
    sec['html'] = ''

    # 公告弹窗结构化
    notice = extract_notice(ms)
    notice_data = None
    if notice:
        o = notice['outer']
        notice_data = {
            'enabled': True,
            'title': re.search(r'<h2>(.*?)</h2>', o, re.S).group(1),
            'badge': re.search(r'<span class="model-notice-badge">(.*?)</span>', o, re.S).group(1),
            'items': re.findall(r'<li>(.*?)</li>', o, re.S),
            'kefu_text': '在线客服',
        }
        sec['notice_outer'] = o
    sec['grid_prefix'] = grid['prefix']
    sec['grid_suffix'] = grid['suffix']
    sec['tabs_prefix'] = tabs['prefix']
    sec['tabs_suffix'] = tabs['suffix']
    seed['notice'] = notice_data

    # 品牌
    brand_labels = {t['id']: t['label'] for t in
                    [{'id': m.group(2), 'label': m.group(3)} for m in
                     re.finditer(r'<button type="button" class="model-tab([^"]*)" data-brand-tab="([^"]*)">(.*?)</button>', tabs['inner'], re.S)]}
    models = json.loads((ROOT / 'data/seed-models.json').read_text(encoding='utf-8'))['models']
    seed['brands'] = [{'id': k, 'label': v, 'order': i, 'enabled': True,
                       'logo': 'assets/img/brands/%s.svg' % k}
                      for i, (k, v) in enumerate(brand_labels.items())]
    seed['models'] = [dict(m, id='m%d' % i, enabled=True, order=i) for i, m in enumerate(models)]
    seed['settings'] = {
        'site_name': '宇天科技',
        'domain': 'a1.yutiankejiai.com',
        'kefu_base': 'https://kefu.yutiankejiai.com',
        'refill_url': 'https://a10.yutiankejiai.com/client/',
        'user_center': 'https://user.yutiankejiai.com/',
        'notice_enabled': True,
        'seo_title': '宇天科技 — 官方品牌站',
        'analytics': '',
        'maintenance': False,
    }
    (ROOT / 'data').mkdir(exist_ok=True)
    (ROOT / 'data/seed.json').write_text(json.dumps(seed, ensure_ascii=False, indent=1), encoding='utf-8')
    print('pages:', list(seed['pages']))
    print('blocks:', len(seed['blocks']), '->', list(seed['blocks'])[:8])
    print('brands:', len(seed['brands']), 'models:', len(seed['models']))
    print('notice items:', len(notice_data['items']) if notice_data else 0)
    print('tabs raw_first:', tabs['raw_first'][:120])
    print('grid template ok:', '\u0000GRID\u0000' in tpl, '\u0000TABS\u0000' in tpl)


if __name__ == '__main__':
    main()
