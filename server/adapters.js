'use strict';
/**
 * 上游协议适配：统一用 OpenAI Chat Completions 的请求/响应形状，
 * 内部转换成各厂商原生协议。
 *   openai     → /v1/chat/completions（原样透传）
 *   anthropic  → /v1/messages（Messages API）
 *   gemini     → /v1beta/models/{model}:generateContent
 */

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(p => (typeof p === 'string' ? p : (p && p.text) || '')).join('');
  }
  return '';
}

function splitSystem(messages) {
  const sys = [];
  const rest = [];
  (messages || []).forEach(m => {
    if (!m) return;
    if (m.role === 'system') sys.push(textOfContent(m.content));
    else rest.push(m);
  });
  return { system: sys.join('\n\n'), messages: rest };
}

/* ------------------------------ Anthropic ------------------------------ */
const anthropic = {
  buildRequest(channel, model, body, stream) {
    const { system, messages } = splitSystem(body.messages);
    const mapped = (channel.model_map && channel.model_map[model]) || model;
    const payload = {
      model: mapped,
      max_tokens: Number(body.max_tokens) || 4096,
      messages: messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: textOfContent(m.content),
      })),
      stream: !!stream,
    };
    if (system) payload.system = system;
    if (body.temperature != null) payload.temperature = Number(body.temperature);
    if (body.top_p != null) payload.top_p = Number(body.top_p);
    if (Array.isArray(body.stop)) payload.stop_sequences = body.stop;
    return {
      url: String(channel.base_url).replace(/\/$/, '') + '/v1/messages',
      options: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': channel.api_key || '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      },
      mappedModel: mapped,
    };
  },

  parseResponse(raw, model) {
    const blocks = Array.isArray(raw && raw.content) ? raw.content : [];
    const text = blocks.filter(b => b && b.type === 'text').map(b => b.text).join('');
    const u = (raw && raw.usage) || {};
    return {
      id: (raw && raw.id) || 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: raw && raw.stop_reason === 'max_tokens' ? 'length' : 'stop',
      }],
      usage: {
        prompt_tokens: Number(u.input_tokens) || 0,
        completion_tokens: Number(u.output_tokens) || 0,
        total_tokens: (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0),
      },
    };
  },

  /** 把 Anthropic SSE 事件转成 OpenAI SSE 行 */
  transformStreamLine(line, ctx) {
    if (!line.startsWith('data:')) return null;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') return null;
    let evt;
    try { evt = JSON.parse(raw); } catch (e) { return null; }
    if (evt.type === 'content_block_delta' && evt.delta && evt.delta.text) {
      return 'data: ' + JSON.stringify({
        id: ctx.id, object: 'chat.completion.chunk', created: ctx.created, model: ctx.model,
        choices: [{ index: 0, delta: { content: evt.delta.text }, finish_reason: null }],
      }) + '\n\n';
    }
    if (evt.type === 'message_start' && evt.message && evt.message.usage) {
      ctx.usage.prompt_tokens = Number(evt.message.usage.input_tokens) || 0;
    }
    if (evt.type === 'message_delta' && evt.usage) {
      ctx.usage.completion_tokens = Number(evt.usage.output_tokens) || 0;
    }
    if (evt.type === 'message_stop') {
      return 'data: ' + JSON.stringify({
        id: ctx.id, object: 'chat.completion.chunk', created: ctx.created, model: ctx.model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }) + '\n\ndata: [DONE]\n\n';
    }
    return null;
  },
};

/* ------------------------------ Gemini ------------------------------ */
const gemini = {
  buildRequest(channel, model, body, stream) {
    const mapped = (channel.model_map && channel.model_map[model]) || model;
    const { system, messages } = splitSystem(body.messages);
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: textOfContent(m.content) }],
    }));
    const payload = { contents };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    const gen = {};
    if (body.temperature != null) gen.temperature = Number(body.temperature);
    if (body.top_p != null) gen.topP = Number(body.top_p);
    if (body.max_tokens != null) gen.maxOutputTokens = Number(body.max_tokens);
    if (Object.keys(gen).length) payload.generationConfig = gen;
    const base = String(channel.base_url).replace(/\/$/, '');
    const method = stream ? 'streamGenerateContent' : 'generateContent';
    const qs = '?key=' + encodeURIComponent(channel.api_key || '') + (stream ? '&alt=sse' : '');
    return {
      url: base + '/v1beta/models/' + encodeURIComponent(mapped) + ':' + method + qs,
      options: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
      mappedModel: mapped,
    };
  },

  parseResponse(raw, model) {
    const cand = (raw && raw.candidates && raw.candidates[0]) || {};
    const parts = (cand.content && cand.content.parts) || [];
    const text = parts.map(p => (p && p.text) || '').join('');
    const u = (raw && raw.usageMetadata) || {};
    return {
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: cand.finishReason === 'MAX_TOKENS' ? 'length' : 'stop',
      }],
      usage: {
        prompt_tokens: Number(u.promptTokenCount) || 0,
        completion_tokens: Number(u.candidatesTokenCount) || 0,
        total_tokens: (Number(u.promptTokenCount) || 0) + (Number(u.candidatesTokenCount) || 0),
      },
    };
  },

  transformStreamLine(line, ctx) {
    if (!line.startsWith('data:')) return null;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') return null;
    let evt;
    try { evt = JSON.parse(raw); } catch (e) { return null; }
    const parts = (evt.candidates && evt.candidates[0] && evt.candidates[0].content && evt.candidates[0].content.parts) || [];
    const text = parts.map(p => (p && p.text) || '').join('');
    if (evt.usageMetadata) {
      ctx.usage.prompt_tokens = Number(evt.usageMetadata.promptTokenCount) || 0;
      ctx.usage.completion_tokens = Number(evt.usageMetadata.candidatesTokenCount) || 0;
    }
    if (evt.candidates && evt.candidates[0] && evt.candidates[0].finishReason) {
      ctx.finished = true;
    }
    if (!text && !ctx.finished) return null;
    return 'data: ' + JSON.stringify({
      id: ctx.id, object: 'chat.completion.chunk', created: ctx.created, model: ctx.model,
      choices: [{ index: 0, delta: text ? { content: text } : {}, finish_reason: ctx.finished ? 'stop' : null }],
    }) + '\n\n';
  },
};

/* ------------------------------ OpenAI ------------------------------ */
const openai = {
  buildRequest(channel, model, body, stream) {
    const mapped = (channel.model_map && channel.model_map[model]) || model;
    const payload = Object.assign({}, body, { model: mapped });
    if (stream) payload.stream_options = Object.assign({ include_usage: true }, body.stream_options || {});
    return {
      url: String(channel.base_url).replace(/\/$/, '') + '/v1/chat/completions',
      options: {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (channel.api_key || '') },
        body: JSON.stringify(payload),
      },
      mappedModel: mapped,
    };
  },
  parseResponse(raw) { return raw; },
  transformStreamLine(line) { return line + '\n'; },
};


/* ------------------------------ Azure OpenAI ------------------------------ */
const azure = {
  buildRequest(channel, model, body, stream) {
    const mapped = (channel.model_map && channel.model_map[model]) || model;
    const ver = channel.api_version || '2024-02-01';
    const base = String(channel.base_url).replace(/\/$/, '');
    const url = base + '/openai/deployments/' + encodeURIComponent(mapped) + '/chat/completions?api-version=' + encodeURIComponent(ver);
    const payload = Object.assign({}, body, { model: undefined });
    delete payload.model;
    if (stream) payload.stream_options = Object.assign({ include_usage: true }, body.stream_options || {});
    return {
      url,
      options: { method: 'POST', headers: { 'content-type': 'application/json', 'api-key': channel.api_key || '' }, body: JSON.stringify(payload) },
      mappedModel: mapped,
    };
  },
  parseResponse(raw) { return raw; },
  transformStreamLine(line) { return line + '\n'; },
};

/* ------------------------------ Google Vertex AI ------------------------------ */
const vertex = {
  buildRequest(channel, model, body) {
    const mapped = (channel.model_map && channel.model_map[model]) || model;
    const base = String(channel.base_url || 'https://us-central1-aiplatform.googleapis.com').replace(/\/$/, '');
    const project = channel.project || 'demo-project';
    const location = channel.location || 'us-central1';
    const url = base + '/v1/projects/' + encodeURIComponent(project) + '/locations/' + encodeURIComponent(location) +
      '/publishers/google/models/' + encodeURIComponent(mapped) + ':generateContent';
    const { system, messages } = splitSystem(body.messages);
    const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: textOfContent(m.content) }] }));
    const payload = { contents };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    const gen = {};
    if (body.temperature != null) gen.temperature = Number(body.temperature);
    if (body.max_tokens != null) gen.maxOutputTokens = Number(body.max_tokens);
    if (Object.keys(gen).length) payload.generationConfig = gen;
    return {
      url,
      options: { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (channel.api_key || '') }, body: JSON.stringify(payload) },
      mappedModel: mapped,
    };
  },
  parseResponse(raw, model) {
    const cand = (raw && raw.candidates && raw.candidates[0]) || {};
    const parts = (cand.content && cand.content.parts) || [];
    const text = parts.map(p => (p && p.text) || '').join('');
    const u = (raw && raw.usageMetadata) || {};
    return {
      id: 'chatcmpl-' + Date.now(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: Number(u.promptTokenCount) || 0, completion_tokens: Number(u.candidatesTokenCount) || 0, total_tokens: (Number(u.promptTokenCount) || 0) + (Number(u.candidatesTokenCount) || 0) },
    };
  },
};

/* ------------------------------ AWS Bedrock (Converse) ------------------------------ */
function hmac(key, data) { return require('crypto').createHmac('sha256', key).update(data).digest(); }
function sha256(data) { return require('crypto').createHash('sha256').update(data).digest('hex'); }

const bedrock = {
  buildRequest(channel, model, body) {
    const mapped = (channel.model_map && channel.model_map[model]) || model;
    const region = channel.region || 'us-east-1';
    const host = 'bedrock-runtime.' + region + '.amazonaws.com';
    const url = 'https://' + host + '/model/' + encodeURIComponent(mapped) + '/converse';
    const { system, messages } = splitSystem(body.messages);
    const payload = {
      messages: messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ text: textOfContent(m.content) }],
      })),
    };
    if (system) payload.system = [{ text: system }];
    const inf = {};
    if (body.temperature != null) inf.temperature = Number(body.temperature);
    if (body.top_p != null) inf.topP = Number(body.top_p);
    if (body.max_tokens != null) inf.maxTokens = Number(body.max_tokens);
    if (Object.keys(inf).length) payload.inferenceConfig = inf;

    const bc = JSON.stringify(payload);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const accessKey = channel.api_key || '';
    const secretKey = channel.api_secret || '';
    const headers = { 'content-type': 'application/json', host, 'x-amz-date': amzDate };

    if (accessKey && secretKey) {
      const canonicalHeaders = 'content-type:application/json\nhost:' + host + '\nx-amz-date:' + amzDate + '\n';
      const signedHeaders = 'content-type;host;x-amz-date';
      const canonicalRequest = ['POST', '/model/' + encodeURIComponent(mapped) + '/converse', '', canonicalHeaders, signedHeaders, sha256(bc)].join('\n');
      const scope = dateStamp + '/' + region + '/bedrock/aws4_request';
      const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
      let k = hmac('AWS4' + secretKey, dateStamp);
      k = hmac(k, region); k = hmac(k, 'bedrock'); k = hmac(k, 'aws4_request');
      const signature = require('crypto').createHmac('sha256', k).update(stringToSign).digest('hex');
      headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
    }
    return { url, options: { method: 'POST', headers, body: bc }, mappedModel: mapped };
  },
  parseResponse(raw, model) {
    const msg = (raw && raw.output && raw.output.message) || {};
    const text = (msg.content || []).map(p => (p && p.text) || '').join('');
    const u = (raw && raw.usage) || {};
    return {
      id: 'chatcmpl-' + Date.now(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: raw && raw.stopReason === 'max_tokens' ? 'length' : 'stop' }],
      usage: { prompt_tokens: Number(u.inputTokens) || 0, completion_tokens: Number(u.outputTokens) || 0, total_tokens: (Number(u.inputTokens) || 0) + (Number(u.outputTokens) || 0) },
    };
  },
};

/* ------------------------------ Cohere ------------------------------ */
const cohere = {
  buildRequest(channel, model, body, stream) {
    const mapped = (channel.model_map && channel.model_map[model]) || model;
    const base = String(channel.base_url || 'https://api.cohere.com').replace(/\/$/, '');
    const { system, messages } = splitSystem(body.messages);
    const payload = {
      model: mapped,
      messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: textOfContent(m.content) })),
      stream: !!stream,
    };
    if (system) payload.messages.unshift({ role: 'system', content: system });
    if (body.max_tokens != null) payload.max_tokens = Number(body.max_tokens);
    if (body.temperature != null) payload.temperature = Number(body.temperature);
    return {
      url: base + '/v2/chat',
      options: { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (channel.api_key || '') }, body: JSON.stringify(payload) },
      mappedModel: mapped,
    };
  },
  parseResponse(raw, model) {
    const text = (raw && raw.message && Array.isArray(raw.message.content) ? raw.message.content.map(c => c.text || '').join('') : (raw && raw.text) || '');
    const u = (raw && raw.usage && raw.usage.tokens) || {};
    return {
      id: (raw && raw.id) || 'chatcmpl-' + Date.now(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: Number(u.input_tokens) || 0, completion_tokens: Number(u.output_tokens) || 0, total_tokens: (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0) },
    };
  },
};

/* ------------------------------ Ollama ------------------------------ */
const ollama = {
  buildRequest(channel, model, body, stream) {
    const mapped = (channel.model_map && channel.model_map[model]) || model;
    const base = String(channel.base_url || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const payload = {
      model: mapped,
      messages: (body.messages || []).map(m => ({ role: m.role, content: textOfContent(m.content) })),
      stream: !!stream,
      options: {},
    };
    if (body.temperature != null) payload.options.temperature = Number(body.temperature);
    if (body.max_tokens != null) payload.options.num_predict = Number(body.max_tokens);
    return {
      url: base + '/api/chat',
      options: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
      mappedModel: mapped,
    };
  },
  parseResponse(raw, model) {
    return {
      id: 'chatcmpl-' + Date.now(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: (raw && raw.message && raw.message.content) || '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: Number(raw && raw.prompt_eval_count) || 0, completion_tokens: Number(raw && raw.eval_count) || 0, total_tokens: (Number(raw && raw.prompt_eval_count) || 0) + (Number(raw && raw.eval_count) || 0) },
    };
  },
};

const PROVIDERS = { openai, anthropic, gemini, azure, vertex, bedrock, cohere, ollama };

const ALIAS = {
  claude: 'anthropic',
  google: 'gemini',
  'azure-openai': 'azure',
  aws: 'bedrock',
  'aws-bedrock': 'bedrock',
  gcp: 'vertex',
  'google-vertex': 'vertex',
  oai: 'openai',
};

/** 供应商预设：用于后台下拉一键填充地址与协议 */
const PRESETS = [
  { id: 'openai', label: 'OpenAI', type: 'openai', base_url: 'https://api.openai.com' },
  { id: 'azure', label: 'Azure OpenAI', type: 'azure', base_url: 'https://YOUR-RESOURCE.openai.azure.com' },
  { id: 'anthropic', label: 'Anthropic Claude', type: 'anthropic', base_url: 'https://api.anthropic.com' },
  { id: 'gemini', label: 'Google Gemini', type: 'gemini', base_url: 'https://generativelanguage.googleapis.com' },
  { id: 'vertex', label: 'Google Vertex AI', type: 'vertex', base_url: 'https://us-central1-aiplatform.googleapis.com' },
  { id: 'bedrock', label: 'AWS Bedrock', type: 'bedrock', base_url: 'https://bedrock-runtime.us-east-1.amazonaws.com' },
  { id: 'cohere', label: 'Cohere', type: 'cohere', base_url: 'https://api.cohere.com' },
  { id: 'ollama', label: 'Ollama 本地', type: 'ollama', base_url: 'http://127.0.0.1:11434' },
  { id: 'deepseek', label: 'DeepSeek', type: 'openai', base_url: 'https://api.deepseek.com' },
  { id: 'moonshot', label: 'Moonshot 月之暗面', type: 'openai', base_url: 'https://api.moonshot.cn' },
  { id: 'zhipu', label: '智谱 GLM', type: 'openai', base_url: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'qwen', label: '阿里通义千问', type: 'openai', base_url: 'https://dashscope.aliyuncs.com/compatible-mode' },
  { id: 'baichuan', label: '百川智能', type: 'openai', base_url: 'https://api.baichuan-ai.com' },
  { id: 'minimax', label: 'MiniMax', type: 'openai', base_url: 'https://api.minimax.chat' },
  { id: 'stepfun', label: '阶跃星辰', type: 'openai', base_url: 'https://api.stepfun.com' },
  { id: 'siliconflow', label: 'SiliconFlow 硅基流动', type: 'openai', base_url: 'https://api.siliconflow.cn' },
  { id: 'groq', label: 'Groq', type: 'openai', base_url: 'https://api.groq.com/openai' },
  { id: 'mistral', label: 'Mistral', type: 'openai', base_url: 'https://api.mistral.ai' },
  { id: 'xai', label: 'xAI Grok', type: 'openai', base_url: 'https://api.x.ai' },
  { id: 'together', label: 'Together AI', type: 'openai', base_url: 'https://api.together.xyz' },
  { id: 'fireworks', label: 'Fireworks', type: 'openai', base_url: 'https://api.fireworks.ai/inference' },
  { id: 'openrouter', label: 'OpenRouter', type: 'openai', base_url: 'https://openrouter.ai/api' },
  { id: 'vllm', label: 'vLLM 自建', type: 'openai', base_url: 'http://127.0.0.1:8000' },
  { id: 'lmstudio', label: 'LM Studio', type: 'openai', base_url: 'http://127.0.0.1:1234' },
];

function forType(type) {
  const t = ALIAS[type] || type;
  return PROVIDERS[t] || openai;
}

module.exports = { forType, PROVIDERS, PRESETS, anthropic, gemini, openai, azure, vertex, bedrock, cohere, ollama };
