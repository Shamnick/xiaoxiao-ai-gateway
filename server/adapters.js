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

function forType(type) {
  if (type === 'anthropic' || type === 'claude') return anthropic;
  if (type === 'gemini' || type === 'google') return gemini;
  return openai;
}

module.exports = { forType, anthropic, gemini, openai };
