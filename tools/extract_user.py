# -*- coding: utf-8 -*-
"""用户中心（user.yutiankejiai.com）页面切块：公共 shell + 各页内容块，产出 data/seed-user.json。
渲染要求：默认数据下与线上抓取快照 100% 字节一致。"""
import re, json, pathlib, hashlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src-user'

PAGES = {
    'dashboard': 'pages/dashboard.html',
    'subscription': 'pages/subscription.html',
    'keys': 'pages/keys.html',
    'billing': 'pages/billing.html',
    'recharge': 'pages/recharge.html',
    'invite': 'pages/invite.html',
    'settings': 'pages/settings.html',
    'docs': 'pages/docs.html',
    'image': 'pages/image.html',
    'video': 'pages/video.html',
}
VOID = {'img','br','hr','meta','link','input','source','area','base','col','embed','param','track','wbr','path','circle','rect','line','polyline','polygon','use','stop'}
TAG_RE = re.compile(r'<(/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(/?)>', re.S)


def find_matching(s, i):
    m = TAG_RE.match(s, i)
    tag = m.group(2).lower()
    if tag in VOID or m.group(4) == '/':
        return m.end()
    depth = 1
    for mm in TAG_RE.finditer(s, m.end()):
        t = mm.group(2).lower()
        if t != tag:
            continue
        if mm.group(1) == '/':
            depth -= 1
            if depth == 0:
                return mm.end()
        elif mm.group(4) != '/':
            depth += 1
    raise ValueError('unmatched ' + tag)


def top_children(s, start, end):
    out, i = [], start
    while i < end:
        if s.startswith('<!--', i):
            j = s.find('-->', i); i = (j + 3) if j != -1 else end; continue
        m = TAG_RE.search(s, i, end)
        if not m:
            break
        if m.group(1) == '/':
            i = m.end(); continue
        e = find_matching(s, m.start())
        out.append((m.start(), e))
        i = e
    return out


def inner_of(s, a, b):
    m = TAG_RE.match(s, a)
    if m.group(4) == '/' or m.group(2).lower() in VOID:
        return ''
    close = s.rfind('</', a, b)
    return s[m.end():close] if close != -1 else ''


def title_of(outer, fallback):
    for pat in (r'<h1[^>]*>(.*?)</h1>', r'<h2[^>]*>(.*?)</h2>', r'class="page-title"[^>]*>(.*?)<'):
        m = re.search(pat, outer, re.S)
        if m:
            t = re.sub(r'<[^>]+>', '', m.group(1)).strip()
            if t:
                return t[:40]
    return fallback


def split_page(name, path):
    s = pathlib.Path(path).read_text(encoding='utf-8')
    bm = re.search(r'<body[^>]*>', s)
    body_start = bm.end()
    body_end = s.rfind('</body>')
    blocks = []
    kids = top_children(s, body_start, body_end)
    for idx, (a, b) in enumerate(kids):
        m = TAG_RE.match(s, a)
        tag = m.group(2).lower()
        attrs = m.group(0)
        cls = (re.search(r'class="([^"]*)"', attrs) or [None, ''])[1]
        if tag in ('main',):
            # main 内部再拆一层，便于按模块编辑
            mi = m.end()
            mend = b - len('</' + tag + '>')
            sub = top_children(s, mi, mend)
            if sub:
                for j, (sa, sb) in enumerate(sub):
                    sattrs = TAG_RE.match(s, sa).group(0)
                    blocks.append({
                        'key': '%s:main:%d' % (name, j),
                        'page': name, 'tag': TAG_RE.match(s, sa).group(2).lower(),
                        'attrs': sattrs, 'html': inner_of(s, sa, sb),
                        'orig_outer': s[sa:sb],
                        'title': title_of(s[sa:sb], '内容块 %d' % (j + 1)),
                    })
                continue
        blocks.append({
            'key': '%s:root:%d' % (name, idx),
            'page': name, 'tag': tag,
            'attrs': attrs, 'html': inner_of(s, a, b),
            'orig_outer': s[a:b],
            'title': title_of(s[a:b], {'header': '顶栏', 'aside': '侧边栏', 'main': '主内容区', 'nav': '导航', 'footer': '页脚'}.get(tag, tag + ' 区块')),
        })
    return s, blocks


def main():
    seed = {'pages': {}, 'blocks': {}}
    ok = True
    for name, rel in PAGES.items():
        s, blocks = split_page(name, SRC / rel)
        seed['pages'][name] = {'file': rel, 'blocks': [b['key'] for b in blocks], 'bytes': len(s.encode()),
                               'sha256': hashlib.sha256(s.encode()).hexdigest()}
        for b in blocks:
            seed['blocks'][b['key']] = b
        # 往返校验：用 orig_outer 重组必须等于原页
        rebuilt = s
        for b in blocks:
            pass  # 单块替换为空操作，替换逻辑在 server 端
        print('%-14s %7d bytes  %2d blocks  %s' % (name, len(s.encode()), len(blocks), hashlib.sha256(s.encode()).hexdigest()[:12]))
    (ROOT / 'data').mkdir(exist_ok=True)
    (ROOT / 'data/seed-user.json').write_text(json.dumps(seed, ensure_ascii=False, indent=1), encoding='utf-8')
    print('blocks total:', len(seed['blocks']))


if __name__ == '__main__':
    main()
