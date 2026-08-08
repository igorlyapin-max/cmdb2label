import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const targetOrigin = String(process.env.CMDB_LABELS_PROXY || 'http://127.0.0.1:8088').replace(/\/+$/, '');
const targetUrl = process.env.CMDB_LABELS_UI_URL || `${targetOrigin}/cmdbuild/labels/ui`;
const chromePath = findChrome();

async function main() {
  await assertReachable(targetUrl);

  const debugPort = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdb2label-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], {
    stdio: ['ignore', 'ignore', 'pipe']
  });

  let chromeStderr = '';
  chrome.stderr.on('data', (chunk) => {
    chromeStderr += chunk.toString('utf8');
    chromeStderr = chromeStderr.slice(-4000);
  });

  try {
    const version = await waitForDevtools(debugPort);
    const tab = await httpJson(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, {
      method: 'PUT'
    });
    const cdp = await CdpConnection.connect(tab.webSocketDebuggerUrl || version.webSocketDebuggerUrl);
    try {
      await cdp.call('Page.enable');
      await cdp.call('Runtime.enable');
      await cdp.call('Page.navigate', { url: targetUrl });
      await waitForUi(cdp);

      const result = await evaluate(cdp, uiScenarioExpression());

      assert.equal(result.title, 'Генератор этикеток 6x3');
      assert.match(result.version.text, /^v(0\.0\.0\.0|\d{2}\.\d{2}\.\d{2}\.\d{2})$/);
      assert.equal(result.version.visible, true);
      assert.equal(result.footer.visible, true);
      assert.match(result.footer.text, /Разработано Департаментом информационных технологий/);
      assert.match(result.footer.href, /^mailto:ritm\.all@gkm\.ru\?subject=/);
      assert.equal(result.first.generateEnabled, true);
      assert.equal(result.first.dataRows, 1);
      assert.equal(result.first.labels, 1);
      assert.equal(result.first.labelVisible, true);
      assert.equal(result.first.qrVisible, true);
      assert.equal(result.first.qrSrc.startsWith('data:image/svg+xml;charset=UTF-8,'), true);
      assert.equal(result.first.row[1], 'INV-RU-001');
      assert.equal(result.first.row[2], 'Принтер');
      assert.equal(result.first.row[3], 'HP LaserJet');
      assert.equal(result.first.row[4], 'SN123');
      assert.equal(result.legacy.generateEnabled, true);
      assert.equal(result.legacy.row[2], 'Рабочая станция');
      assert.equal(result.missing.generateDisabled, true);
      assert.equal(result.missing.summaryVisible, true);
      assert.match(result.missing.errorsText, /Тип/);

      console.log(`labels UI smoke ok: ${targetUrl}`);
    } finally {
      cdp.close();
    }
  } catch (error) {
    if (chromeStderr) {
      process.stderr.write(chromeStderr);
      process.stderr.write('\n');
    }
    throw error;
  } finally {
    chrome.kill('SIGTERM');
    await sleep(500);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Chrome/Chromium not found. Set CHROME_BIN to run browser smoke.');
  return found;
}

async function assertReachable(url) {
  const response = await httpRequest(url, { method: 'GET', timeoutMs: 3000 });
  if (response.statusCode !== 200 || !/^text\/html/i.test(String(response.headers['content-type'] || ''))) {
    throw new Error(`Labels UI is not reachable at ${url}: HTTP ${response.statusCode}`);
  }
}

async function waitForDevtools(port) {
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await httpJson(`http://127.0.0.1:${port}/json/version`);
    } catch (error) {
      lastError = error;
      await sleep(150);
    }
  }
  throw new Error(`Chrome DevTools did not start: ${lastError ? lastError.message : 'timeout'}`);
}

async function waitForUi(cdp) {
  const deadline = Date.now() + 8000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const ready = await evaluate(cdp, `Boolean(document.readyState === 'complete' && window.importCsvFromTextarea && document.getElementById('btnGenerate'))`);
      if (ready) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`Labels UI did not become ready: ${lastError ? lastError.message : 'timeout'}`);
}

async function evaluate(cdp, expression) {
  const response = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return response.result && response.result.value;
}

function uiScenarioExpression() {
  return `(${async function runLabelsUiSmoke() {
    let stage = 'init';
    const waitFor = (predicate, timeoutMs = 5000) => new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        try {
          if (predicate()) {
            resolve(true);
            return;
          }
        } catch (error) {
          reject(error);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`UI condition timeout: ${stage}`));
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
    const byId = (id) => document.getElementById(id);
    const versionBadge = byId('appVersion');
    const versionBox = versionBadge ? versionBadge.getBoundingClientRect() : null;
    const version = {
      text: versionBadge ? versionBadge.textContent.trim() : '',
      visible: Boolean(versionBox && versionBox.width > 0 && versionBox.height > 0)
    };
    const footerElement = byId('pageFooter');
    const footerBox = footerElement ? footerElement.getBoundingClientRect() : null;
    const footerLink = footerElement ? footerElement.querySelector('[data-footer-email]') : null;
    const footer = {
      text: footerElement ? footerElement.textContent.trim() : '',
      href: footerLink ? footerLink.getAttribute('href') || '' : '',
      visible: Boolean(footerBox && footerBox.width > 0 && footerBox.height > 0)
    };
    const rowText = () => Array.from(document.querySelectorAll('#deviceListBody tr')[0].cells)
      .map((cell) => cell.textContent.trim());
    const state = () => ({
      generateDisabled: byId('btnGenerate').disabled,
      rows: document.querySelectorAll('#deviceListBody tr').length,
      previewCount: byId('devicePreviewCount').textContent,
      summaryVisible: byId('validationSummary').classList.contains('show'),
      errorsText: byId('validationErrors').textContent,
      resolveStatus: byId('resolveStatus').textContent
    });
    const waitForGenerateEnabled = async () => {
      try {
        await waitFor(() => byId('btnGenerate').disabled === false);
      } catch (error) {
        throw new Error(`${error.message}; state=${JSON.stringify(state())}`);
      }
    };

    clearAll();
    stage = 'complete import';
    byId('csvInput').value = 'Инв. номер;Тип/Модель;Тип;SN\nINV-RU-001;HP LaserJet;Принтер;SN123';
    await importCsvFromTextarea();
    stage = 'complete generate enabled';
    await waitForGenerateEnabled();
    stage = 'complete generate';
    await generate();
    stage = 'complete label visible';
    await waitFor(() => document.querySelectorAll('.label').length === 1);
    const label = document.querySelector('.label');
    const labelBox = label.getBoundingClientRect();
    const qr = label.querySelector('.lbl-qr img');
    const qrBox = qr.getBoundingClientRect();
    const first = {
      generateEnabled: byId('btnGenerate').disabled === false,
      dataRows: document.querySelectorAll('#deviceListBody tr').length,
      labels: document.querySelectorAll('.label').length,
      labelVisible: labelBox.width > 0 && labelBox.height > 0,
      qrVisible: qrBox.width > 0 && qrBox.height > 0,
      qrSrc: qr.getAttribute('src') || '',
      row: rowText()
    };

    clearAll();
    stage = 'legacy import';
    byId('csvInput').value = 'Инв. номер;Тип/Модель;Группа модели;SN\nINV-LEGACY;HP 1111;Рабочая станция;SN124';
    await importCsvFromTextarea();
    stage = 'legacy generate enabled';
    await waitForGenerateEnabled();
    const legacy = {
      generateEnabled: byId('btnGenerate').disabled === false,
      row: rowText()
    };

    clearAll();
    stage = 'missing import';
    byId('csvInput').value = 'Инв. номер;Тип/Модель;SN\n;HP 1111;';
    await importCsvFromTextarea();
    const missing = {
      generateDisabled: byId('btnGenerate').disabled === true,
      summaryVisible: byId('validationSummary').classList.contains('show'),
      errorsText: byId('validationErrors').textContent
    };

    return { title: document.title, version, footer, first, legacy, missing };
  }})()`;
}

function httpJson(url, options = {}) {
  return httpRequest(url, options).then((response) => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`HTTP ${response.statusCode} for ${url}`);
    }
    return JSON.parse(response.body);
  });
}

function httpRequest(url, options = {}) {
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request({
      method: options.method || 'GET',
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      timeout: options.timeoutMs || 5000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('timeout', () => req.destroy(new Error(`Request timeout for ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.frameBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (error) => this.rejectAll(error));
    socket.on('close', () => this.rejectAll(new Error('CDP websocket closed')));
  }

  static async connect(wsUrl) {
    const target = new URL(wsUrl);
    const socket = await websocketUpgrade(target);
    return new CdpConnection(socket);
  }

  call(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const message = JSON.stringify({ id, method, params });
    this.socket.write(encodeWebsocketFrame(Buffer.from(message, 'utf8')));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP call timeout: ${method}`));
      }, 10000).unref();
    }).then((response) => {
      if (response.error) throw new Error(response.error.message || `CDP error: ${method}`);
      return response.result || {};
    });
  }

  onData(chunk) {
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);
    while (this.frameBuffer.length >= 2) {
      const parsed = decodeWebsocketFrame(this.frameBuffer);
      if (!parsed) return;
      this.frameBuffer = this.frameBuffer.slice(parsed.bytes);
      if (parsed.opcode === 8) {
        this.rejectAll(new Error('CDP websocket closed by peer'));
        return;
      }
      if (parsed.opcode !== 1) continue;
      const message = JSON.parse(parsed.payload.toString('utf8'));
      if (!message.id) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      pending.resolve(message);
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  close() {
    this.socket.end();
  }
}

function websocketUpgrade(target) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: target.hostname,
      port: Number(target.port || 80)
    });
    const key = crypto.randomBytes(16).toString('base64');
    let buffer = Buffer.alloc(0);
    let completed = false;

    socket.on('connect', () => {
      socket.write([
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        `Host: ${target.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        ''
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      if (completed) return;
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd).toString('utf8');
      if (!/^HTTP\/1\.1 101 /i.test(header)) {
        reject(new Error(`WebSocket upgrade failed: ${header.split('\r\n')[0] || 'no status'}`));
        socket.destroy();
        return;
      }
      completed = true;
      socket.setTimeout(0);
      socket.pause();
      const rest = buffer.slice(headerEnd + 4);
      socket.removeAllListeners('data');
      socket.resume();
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    });
    socket.on('error', reject);
    socket.setTimeout(5000, () => {
      socket.destroy(new Error('WebSocket upgrade timeout'));
    });
  });
}

function encodeWebsocketFrame(payload) {
  const length = payload.length;
  const headerLength = length < 126 ? 6 : length < 65536 ? 8 : 14;
  const frame = Buffer.alloc(headerLength + length);
  frame[0] = 0x81;
  if (length < 126) {
    frame[1] = 0x80 | length;
    crypto.randomFillSync(frame, 2, 4);
    maskPayload(payload, frame.subarray(2, 6), frame, 6);
  } else if (length < 65536) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(length, 2);
    crypto.randomFillSync(frame, 4, 4);
    maskPayload(payload, frame.subarray(4, 8), frame, 8);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
    crypto.randomFillSync(frame, 10, 4);
    maskPayload(payload, frame.subarray(10, 14), frame, 14);
  }
  return frame;
}

function maskPayload(payload, mask, frame, offset) {
  for (let index = 0; index < payload.length; index += 1) {
    frame[offset + index] = payload[index] ^ mask[index % 4];
  }
}

function decodeWebsocketFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = Boolean(buffer[1] & 0x80);
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  let mask = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return { opcode, payload, bytes: offset + length };
}

await main();
