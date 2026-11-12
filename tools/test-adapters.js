'use strict';
/** 上游协议适配测试：起本地 mock OpenAI / Anthropic / Gemini 服务，验证请求转换与响应归一 */
const http = require('http');
const BASE = 'http://127.0.0.1:8848';
let pass = 0, fail = 0;
function ok(n) { pass++; console.log('  ✓ ' + n); }
function bad(n, d) { fail++; console.log('  ✗ ' + n + ' → ' + d); }

const seen = {};
function mkServer(port, handler) {
  return new Promise(r => { const s = http.createServer(handler); s.listen(port, () => r(s)); });
}

async function api(path, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json' };
  if (o.cookie) headers.cookie = o.cookie;
  const res = await fetch(BASE + path, { method: o.method || 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined });
  const sc = res.headers.get('set-cookie');
  let data = null; try { data = await res.json(); } catch (e) {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : null };
}

(async () => {
  const servers = [];
  // OpenAI 兼容
  servers.push(await mkServer(7101, (req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      seen.openai = JSON.parse(b || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'oa', object: 'chat.completion', model: seen.openai.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'openai-ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 7 } }));
    });
  }));
  // Anthropic
  servers.push(await mkServer(7102, (req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      seen.anthropic = { headers: req.headers, body: JSON.parse(b || '{}') };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant',
        content: [{ type: 'text', text: 'anthropic-ok' }], stop_reason: 'end_turn',
        usage: { input_tokens: 12, output_tokens: 5 } }));
    });
  }));
  // Gemini
  servers.push(await mkServer(7103, (req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      seen.gemini = { url: req.url, body: JSON.parse(b || '{}') };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini-ok' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 } }));
    });
  }));

  try {
    const login = await api('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    const ck = login.cookie;
    const ulogin = await api('/api/user/login', { method: 'POST', body: { username: 'sham', password: 'ioioio000' } });
    const key = (await api('/api/user/keys', { cookie: ulogin.cookie, method: 'POST', body: { name: '协议测试' } })).data.key;

    const mk = async (name, type, base, models) => (await api('/api/admin/channels', { cookie: ck, method: 'POST',
      body: { name, type, base_url: base, api_key: 'test-key', models, priority: 100, model_map: { 'GPT-6-Astra-max': type + '-mapped', 'Claude-Test': type + '-mapped', 'Gemini-Test': type + '-mapped' } } })).data.channel.id;

    const idOA = await mk('测试-OpenAI', 'openai', 'http://127.0.0.1:7101', ['GPT-6-Astra-max']);
    const idAN = await mk('测试-Anthropic', 'anthropic', 'http://127.0.0.1:7102', ['Claude-Test']);
    const idGM = await mk('测试-Gemini', 'gemini', 'http://127.0.0.1:7103', ['Gemini-Test']);

    const call = async (model) => {
      const r = await fetch(BASE + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key.key },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: '你是助手' }, { role: 'user', content: '你好' }], max_tokens: 128 }),
      });
      return { status: r.status, data: await r.json() };
    };

    // OpenAI
    let r = await call('GPT-6-Astra-max');
    r.status === 200 && r.data.choices[0].message.content === 'openai-ok' ? ok('OpenAI 上游透传') : bad('OpenAI 上游', JSON.stringify(r.data).slice(0, 100));
    seen.openai.model === 'openai-mapped' ? ok('OpenAI 模型映射生效') : bad('OpenAI 模型映射', seen.openai.model);

    // Anthropic
    r = await call('Claude-Test');
    r.status === 200 && r.data.choices[0].message.content === 'anthropic-ok' ? ok('Anthropic 响应归一为 OpenAI 格式') : bad('Anthropic 响应', JSON.stringify(r.data).slice(0, 120));
    const ab = seen.anthropic.body;
    ab.system === '你是助手' ? ok('Anthropic system 已分离') : bad('Anthropic system', JSON.stringify(ab.system));
    (ab.messages || []).every(m => m.role !== 'system') ? ok('Anthropic messages 无 system 角色') : bad('Anthropic messages', JSON.stringify(ab.messages));
    ab.max_tokens === 128 ? ok('Anthropic max_tokens 透传') : bad('Anthropic max_tokens', ab.max_tokens);
    seen.anthropic.headers['x-api-key'] === 'test-key' ? ok('Anthropic 使用 x-api-key 头') : bad('Anthropic header', JSON.stringify(seen.anthropic.headers));
    r.data.usage.prompt_tokens === 12 ? ok('Anthropic usage 映射（input→prompt）') : bad('Anthropic usage', JSON.stringify(r.data.usage));

    // Gemini
    r = await call('Gemini-Test');
    r.status === 200 && r.data.choices[0].message.content === 'gemini-ok' ? ok('Gemini 响应归一为 OpenAI 格式') : bad('Gemini 响应', JSON.stringify(r.data).slice(0, 120));
    const gb = seen.gemini.body;
    (gb.contents || []).length === 1 && gb.contents[0].role === 'user' ? ok('Gemini contents 结构正确') : bad('Gemini contents', JSON.stringify(gb.contents));
    gb.systemInstruction && gb.systemInstruction.parts[0].text === '你是助手' ? ok('Gemini systemInstruction 正确') : bad('Gemini system', JSON.stringify(gb.systemInstruction));
    seen.gemini.url.indexOf('gemini-mapped') !== -1 ? ok('Gemini 模型映射进 URL') : bad('Gemini URL', seen.gemini.url);
    r.data.usage.completion_tokens === 4 ? ok('Gemini usage 映射') : bad('Gemini usage', JSON.stringify(r.data.usage));

    // 清理
    for (const id of [idOA, idAN, idGM]) await api('/api/admin/channels/' + id, { cookie: ck, method: 'DELETE' });
    await api('/api/user/keys/' + key.id, { cookie: ulogin.cookie, method: 'DELETE' });
  } catch (e) {
    bad('异常', e.message);
  } finally {
    servers.forEach(s => s.close());
  }
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 2 : 0);
})();
