'use strict';
/**
 * Google 服务账号 OAuth2：用 JWT Bearer 换 access token（零依赖，Node crypto 签名 RS256）。
 * 用于 Vertex AI（渠道填 service_account JSON 即可自动续 token）。
 */
const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const CACHE = new Map(); // channelId → { token, exp }

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 用服务账号 JSON 构造签名 JWT */
function buildJwt(sa, now) {
  const iat = now || Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: iat + 3600,
    iat,
  };
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(sa.private_key);
  return signingInput + '.' + b64url(signature);
}

/** 换取 access token（带缓存，提前 60s 过期） */
async function getAccessToken(channelId, serviceAccount) {
  const cached = CACHE.get(channelId);
  if (cached && cached.exp > Date.now() + 60000) return cached.token;

  let sa = serviceAccount;
  if (typeof sa === 'string') {
    try { sa = JSON.parse(sa); } catch (e) { throw new Error('服务账号 JSON 解析失败'); }
  }
  if (!sa || !sa.client_email || !sa.private_key) throw new Error('服务账号缺少 client_email / private_key');

  const jwt = buildJwt(sa);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt),
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error('换取 access token 失败：' + (data.error_description || data.error || ('HTTP ' + res.status)));
  }
  const ttl = Number(data.expires_in) || 3600;
  CACHE.set(channelId, { token: data.access_token, exp: Date.now() + ttl * 1000 });
  return data.access_token;
}

function clearCache(channelId) { CACHE.delete(channelId); }

module.exports = { buildJwt, getAccessToken, clearCache, SCOPE, TOKEN_URL };
