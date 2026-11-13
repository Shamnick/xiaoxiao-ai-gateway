'use strict';
/** 供应商协议单测：buildRequest 的 URL/头/体 与 parseResponse 的归一 */
const a = require('../server/adapters');
let pass = 0, fail = 0;
const ok = n => { pass++; console.log('  ✓ ' + n); };
const bad = (n, d) => { fail++; console.log('  ✗ ' + n + ' → ' + d); };
const body = { model: 'm1', messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'HI' }], max_tokens: 256, temperature: 0.3 };

/* Azure */
{
  const ch = { type: 'azure', base_url: 'https://res.openai.azure.com', api_key: 'K', api_version: '2024-06-01', model_map: { m1: 'deploy-gpt4' } };
  const r = a.forType('azure').buildRequest(ch, 'm1', body, false);
  r.url.includes('/openai/deployments/deploy-gpt4/chat/completions') ? ok('Azure URL 含 deployment') : bad('Azure URL', r.url);
  r.url.includes('api-version=2024-06-01') ? ok('Azure api-version 正确') : bad('Azure version', r.url);
  r.options.headers['api-key'] === 'K' ? ok('Azure 使用 api-key 头') : bad('Azure header', JSON.stringify(r.options.headers));
  const p = JSON.parse(r.options.body);
  p.model === undefined ? ok('Azure 移除 model 字段') : bad('Azure body model', p.model);
}

/* Vertex */
{
  const ch = { type: 'vertex', base_url: 'https://us-central1-aiplatform.googleapis.com', api_key: 'T', project: 'proj-x', location: 'us-central1' };
  const r = a.forType('vertex').buildRequest(ch, 'gemini-1.5-pro', body, false);
  r.url.includes('/v1/projects/proj-x/locations/us-central1/publishers/google/models/gemini-1.5-pro:generateContent')
    ? ok('Vertex URL 结构正确') : bad('Vertex URL', r.url);
  const p = JSON.parse(r.options.body);
  p.systemInstruction && p.systemInstruction.parts[0].text === 'SYS' ? ok('Vertex systemInstruction') : bad('Vertex system', JSON.stringify(p.systemInstruction));
  p.generationConfig && p.generationConfig.maxOutputTokens === 256 ? ok('Vertex generationConfig') : bad('Vertex gen', JSON.stringify(p.generationConfig));
  const parsed = a.forType('vertex').parseResponse({ candidates: [{ content: { parts: [{ text: 'V' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }, 'x');
  parsed.choices[0].message.content === 'V' && parsed.usage.prompt_tokens === 5 ? ok('Vertex 响应归一') : bad('Vertex parse', JSON.stringify(parsed).slice(0, 80));
}

/* Bedrock */
{
  const ch = { type: 'bedrock', region: 'us-east-1', api_key: 'AKIA', api_secret: 'SECRET' };
  const r = a.forType('bedrock').buildRequest(ch, 'anthropic.claude-3', body, false);
  r.url.includes('/model/anthropic.claude-3/converse') ? ok('Bedrock Converse URL') : bad('Bedrock URL', r.url);
  (r.options.headers.authorization || '').startsWith('AWS4-HMAC-SHA256 Credential=AKIA/') ? ok('Bedrock SigV4 签名生成') : bad('Bedrock 签名', JSON.stringify(r.options.headers.authorization || ''));
  const p = JSON.parse(r.options.body);
  p.system && p.system[0].text === 'SYS' ? ok('Bedrock system 结构') : bad('Bedrock system', JSON.stringify(p.system));
  p.messages[0].content[0].text === 'HI' ? ok('Bedrock content 块结构') : bad('Bedrock messages', JSON.stringify(p.messages));
  const parsed = a.forType('bedrock').parseResponse({ output: { message: { content: [{ text: 'B' }] } }, usage: { inputTokens: 4, outputTokens: 3 } }, 'x');
  parsed.choices[0].message.content === 'B' ? ok('Bedrock 响应归一') : bad('Bedrock parse', JSON.stringify(parsed).slice(0, 80));
}

/* Cohere */
{
  const ch = { type: 'cohere', base_url: 'https://api.cohere.com', api_key: 'C' };
  const r = a.forType('cohere').buildRequest(ch, 'command-r', body, false);
  r.url === 'https://api.cohere.com/v2/chat' ? ok('Cohere /v2/chat 地址') : bad('Cohere URL', r.url);
  const p = JSON.parse(r.options.body);
  p.messages[0].role === 'system' ? ok('Cohere system 内联首条') : bad('Cohere messages', JSON.stringify(p.messages[0]));
  const parsed = a.forType('cohere').parseResponse({ message: { content: [{ text: 'C1' }, { text: 'C2' }] }, usage: { tokens: { input_tokens: 6, output_tokens: 2 } } }, 'x');
  parsed.choices[0].message.content === 'C1C2' && parsed.usage.prompt_tokens === 6 ? ok('Cohere 响应归一') : bad('Cohere parse', JSON.stringify(parsed).slice(0, 80));
}

/* Ollama */
{
  const ch = { type: 'ollama', base_url: 'http://127.0.0.1:11434' };
  const r = a.forType('ollama').buildRequest(ch, 'llama3', body, false);
  r.url === 'http://127.0.0.1:11434/api/chat' ? ok('Ollama /api/chat 地址') : bad('Ollama URL', r.url);
  const p = JSON.parse(r.options.body);
  p.options && p.options.num_predict === 256 ? ok('Ollama 参数映射') : bad('Ollama options', JSON.stringify(p.options));
  const parsed = a.forType('ollama').parseResponse({ message: { content: 'O' }, prompt_eval_count: 7, eval_count: 2 }, 'x');
  parsed.choices[0].message.content === 'O' && parsed.usage.completion_tokens === 2 ? ok('Ollama 响应归一') : bad('Ollama parse', JSON.stringify(parsed).slice(0, 80));
}

/* 别名与预设 */
{
  a.forType('claude') === a.anthropic ? ok('别名 claude → anthropic') : bad('别名 claude');
  a.forType('gcp') === a.vertex ? ok('别名 gcp → vertex') : bad('别名 gcp');
  a.forType('unknown-xyz') === a.openai ? ok('未知类型回退 openai') : bad('未知回退');
  a.PRESETS.length >= 20 ? ok('供应商预设 ' + a.PRESETS.length + ' 个') : bad('预设数量', a.PRESETS.length);
  a.PRESETS.every(p => p.id && p.label && p.type && p.base_url) ? ok('预设字段完整') : bad('预设字段缺失');
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 2 : 0);
