'use strict';
/**
 * 上游连通性验证：逐个渠道实测（不经过平台，直接用渠道配置打上游）
 * 用法: node tools/verify-upstreams.js [--only=渠道名关键字] [--timeout=8000]
 */
const store = require('../server/store');
const googleAuth = require('../server/google-auth');
const adapters = require('../server/adapters');

const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';
const timeout = Number((args.find(a => a.startsWith('--timeout=')) || '').split('=')[1]) || 8000;

async function probe(ch) {
  const t0 = Date.now();
  const t = ch.type || 'openai';
  try {
    if (t === 'mock') return { ok: true, note: '内置演示渠道，无需上游', ms: 0 };
    if (!ch.base_url) return { ok: false, note: '未配置 base_url' };

    if (t === 'vertex' && ch.service_account) {
      const tk = await googleAuth.getAccessToken('verify:' + ch.id, ch.service_account);
      return { ok: true, note: 'OAuth token 获取成功（' + tk.length + ' 字符）', ms: Date.now() - t0 };
    }
    if (t === 'bedrock') {
      if (!ch.api_key || !ch.api_secret) return { ok: false, note: 'Bedrock 需要 api_key(AK) + api_secret(SK)' };
      const a = adapters.forType('bedrock');
      const req = a.buildRequest(ch, ch.models && ch.models[0] !== '*' ? ch.models[0] : 'anthropic.claude-3-haiku-20240307-v1:0',
        { messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 }, false);
      const r = await fetch(req.url, Object.assign({}, req.options, { signal: AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined }));
      const txt = await r.text();
      return r.ok
        ? { ok: true, note: 'Converse 可用', ms: Date.now() - t0 }
        : { ok: false, note: 'HTTP ' + r.status + ' ' + txt.slice(0, 90), ms: Date.now() - t0 };
    }

    const adapter = adapters.forType(t);
    const model = (ch.models || []).find(m => m !== '*') || '*';
    const req = adapter.buildRequest(ch, model, { messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 }, false);
    const r = await fetch(req.url, Object.assign({}, req.options, { signal: AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined }));
    const txt = await r.text();
    if (!r.ok) return { ok: false, note: 'HTTP ' + r.status + ' ' + txt.slice(0, 90), ms: Date.now() - t0 };
    return { ok: true, note: '可用（' + r.status + '）', ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, note: e.message.slice(0, 120), ms: Date.now() - t0 };
  }
}

(async () => {
  const db = store.load();
  const channels = ((db.platform && db.platform.channels) || []).filter(c => !only || String(c.name).includes(only));
  if (!channels.length) { console.log('没有匹配的渠道'); process.exit(0); }

  console.log('渠道数：' + channels.length + '\n');
  let okN = 0, badN = 0;
  for (const ch of channels) {
    const r = await probe(ch);
    if (r.ok) okN++; else badN++;
    console.log((r.ok ? '✓' : '✗') + ' [' + (ch.type || 'openai') + '] ' + ch.name + '  ' + (r.ok ? '' : '→ ' + r.note) + (r.ms ? '  (' + r.ms + 'ms)' : ''));
  }
  console.log('\n可用 ' + okN + ' / 失败 ' + badN);
  process.exit(badN ? 2 : 0);
})();
