'use strict';
/**
 * 极简 SMTP 客户端（零依赖）：支持 465 隐式 TLS、25/587 明文，
 * 可选 STARTTLS；发送失败不抛出，返回 { ok, error }，由调用方降级。
 */
const net = require('net');
const tls = require('tls');

function b64(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }

function createSession(socket) {
  let buf = '';
  const waiters = [];
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buf += chunk;
    flush();
  });
  socket.on('error', (err) => {
    while (waiters.length) waiters.shift().reject(err);
  });
  socket.on('close', () => {
    while (waiters.length) waiters.shift().reject(new Error('连接已关闭'));
  });
  function flush() {
    while (waiters.length) {
      const lines = buf.split(/\r?\n/);
      let end = -1;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l === '') continue;
        if (/^\d{3}-/.test(l)) continue;       // 多行响应的续行
        if (/^\d{3} /.test(l)) { end = i; break; } // 最后一行
        break;                                  // 非协议行
      }
      if (end === -1) return;
      const block = lines.slice(0, end + 1);
      const code = Number(block[end].slice(0, 3));
      buf = lines.slice(end + 1).join('\r\n');
      const w = waiters.shift();
      w.resolve({ code, text: block.join('\n') });
    }
  }
  return {
    expect() { return new Promise((resolve, reject) => { waiters.push({ resolve, reject }); flush(); }); },
    cmd(line) { socket.write(line + '\r\n'); return this.expect(); },
    raw(data) { socket.write(data); return this.expect(); },
    socket,
  };
}

function sendMail(cfg, mail) {
  return new Promise((resolve) => {
    const host = cfg.host;
    const port = Number(cfg.port) || (cfg.secure ? 465 : 25);
    if (!host) return resolve({ ok: false, error: '未配置 SMTP 服务器' });

    let settled = false;
    const done = (r) => { if (!settled) { settled = true; try { socket.destroy(); } catch (e) {} resolve(r); } };

    const socket = cfg.secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: cfg.reject_unauthorized !== false })
      : net.connect({ host, port });
    socket.setTimeout(15000, () => done({ ok: false, error: 'SMTP 连接超时' }));

    const s = createSession(socket);
    (async () => {
      const greet = await s.expect();
      if (greet.code !== 220) throw new Error('SMTP 握手失败：' + greet.text);

      let r = await s.cmd('EHLO xiaoxiao-gateway');
      if (r.code !== 250) r = await s.cmd('HELO xiaoxiao-gateway');
      if (r.code !== 250) throw new Error('EHLO 被拒：' + r.text);

      if (cfg.user) {
        r = await s.cmd('AUTH LOGIN');
        if (r.code !== 334) throw new Error('AUTH 被拒：' + r.text);
        await s.cmd(b64(cfg.user));
        r = await s.cmd(b64(cfg.pass || ''));
        if (r.code !== 235) throw new Error('认证失败：' + r.text);
      }

      const from = cfg.from || cfg.user || 'noreply@localhost';
      r = await s.cmd('MAIL FROM:<' + from + '>');
      if (r.code !== 250) throw new Error('MAIL FROM 被拒：' + r.text);
      r = await s.cmd('RCPT TO:<' + mail.to + '>');
      if (r.code !== 250 && r.code !== 251) throw new Error('RCPT TO 被拒：' + r.text);
      r = await s.cmd('DATA');
      if (r.code !== 354) throw new Error('DATA 被拒：' + r.text);

      const subject = '=?UTF-8?B?' + b64(mail.subject || '') + '?=';
      const body = [
        'From: ' + from,
        'To: ' + mail.to,
        'Subject: ' + subject,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64(mail.text || ''),
        '.',
      ].join('\r\n');
      r = await s.raw(body);
      if (r.code !== 250) throw new Error('发送失败：' + r.text);
      await s.cmd('QUIT').catch(() => {});
      done({ ok: true });
    })().catch((err) => done({ ok: false, error: err.message }));
  });
}

module.exports = { sendMail };
