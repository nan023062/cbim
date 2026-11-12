// 本地 A→B 验收的外部网络夹具。只服务已校验的固定附件，不修改产品、公开源或 TLS 设置。
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parse} from 'yaml';

export async function fileDigest(file, algorithm = 'sha256', encoding = 'hex') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

/** 在复制到测试机后也能核验，不依赖回执中的原构建机器路径。 */
export async function readTestCandidate(directory, version) {
  directory = path.resolve(directory);
  const receipt = JSON.parse(await fs.readFile(path.join(directory, 'build-receipt.json'), 'utf8'));
  assert.equal(receipt.version, version);
  assert.equal(receipt.signing.mode, 'unsigned');
  const names = [`CBIM-Setup-${version}-x64.exe`, `CBIM-Setup-${version}-x64.exe.blockmap`, 'latest.yml'];
  assert.deepEqual(receipt.artifacts.map(item => item.name), names);
  for (const asset of receipt.artifacts) {
    const file = path.join(directory, asset.name);
    assert.equal((await fs.stat(file)).size, asset.size, asset.name);
    assert.equal(await fileDigest(file), asset.sha256, asset.name);
  }
  assert.equal(await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8'), receipt.artifacts.map(a => `${a.sha256}  ${a.name}`).join('\n') + '\n');
  const manifest = parse(await fs.readFile(path.join(directory, 'latest.yml'), 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.path, names[0]);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].url, names[0]);
  assert.equal(manifest.files[0].size, receipt.artifacts[0].size);
  assert.equal(manifest.sha512, await fileDigest(path.join(directory, names[0]), 'sha512', 'base64'));
  assert.equal(manifest.files[0].sha512, manifest.sha512);
  assert.equal(manifest.packages, undefined);
  return {directory, version, receipt, installer: path.join(directory, names[0])};
}

/** 证明启动的是未修改的 A/B 程序；只读比较，不将安装路径当成隔离环境。 */
export async function verifyTestExecutable(executable, candidate) {
  assert.equal(path.basename(executable), 'CBIM Desktop.exe');
  assert.deepEqual(Object.keys(candidate.receipt.resources).sort(), ['app.asar', 'app-update.yml', 'desktop-release.json'].sort());
  const entry = candidate.receipt.payload.find(item => item.file === 'CBIM Desktop.exe');
  assert.equal(await fileDigest(executable), entry.sha256);
  for (const [name, expected] of Object.entries(candidate.receipt.resources)) {
    assert.equal(await fileDigest(path.join(path.dirname(executable), 'resources', name)), expected, name);
  }
}

/** 仅监听 127.0.0.1，精确白名单路由；记录完成的响应字节，不暴露任意本地文件。 */
export async function startLocalUpdateFixture(a, b) {
  const requests = [], files = new Map();
  for (const candidate of [a, b]) for (const asset of candidate.receipt.artifacts) {
    files.set(`/nan023062/cbim/releases/download/desktop-v${candidate.version}/${asset.name}`, {...asset, file: path.join(candidate.directory, asset.name)});
  }
  const listPath = '/repos/nan023062/cbim/releases';
  const release = {
    draft: false, prerelease: false, tag_name: 'desktop-v' + b.version,
    html_url: 'https://github.com/nan023062/cbim/releases/tag/desktop-v' + b.version,
    published_at: b.receipt.completedAt,
    body: '仅本地测试响应：A → B。没有创建或修改 GitHub Release。',
    assets: b.receipt.artifacts.map(asset => ({name: asset.name, size: asset.size, state: 'uploaded', browser_download_url: `https://github.com/nan023062/cbim/releases/download/desktop-v${b.version}/${asset.name}`})),
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const record = {path: url.pathname, range: req.headers.range ?? null, status: 0, bytes: 0, complete: false};
    requests.push(record);
    res.once('finish', () => {record.complete = true;});
    const end = (status, body = '') => {
      const data = Buffer.from(body); record.status = status; record.bytes = data.length;
      res.writeHead(status, {'Content-Length': data.length, 'Content-Type': 'application/json'}); res.end(data);
    };
    if (req.method !== 'GET') return end(405);
    if (url.pathname === listPath) return end(200, JSON.stringify(url.searchParams.get('page') === '1' ? [release] : []));
    const asset = files.get(url.pathname);
    if (!asset) return end(404);
    let start = 0, finish = asset.size - 1;
    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
      if (!match) return end(416);
      start = Number(match[1]); finish = Number(match[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(finish) || start > finish || finish >= asset.size) return end(416);
    }
    record.status = req.headers.range ? 206 : 200;
    const headers = {'Content-Length': finish - start + 1, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream'};
    if (record.status === 206) headers['Content-Range'] = `bytes ${start}-${finish}/${asset.size}`;
    res.writeHead(record.status, headers);
    const stream = createReadStream(asset.file, {start, end: finish});
    stream.on('data', bytes => {record.bytes += bytes.length;});
    stream.on('error', error => res.destroy(error));
    res.once('close', () => stream.destroy());
    stream.pipe(res);
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    allowedPaths: [listPath, ...files.keys()], requests,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

/**
 * 通过外部调试会话仅替换两个网络边界：Node fetch 的发布列表和 Electron net 的附件请求。
 * 原 URL、版本筛选、真实差分、缓存、SHA-512 与更新状态机继续由未改动的 A 执行。
 * 不注入 ready、不调用 install；默认拦截安装进程，仅人工隔离安装测试显式放行。
 */
export async function attachLocalUpdateTransport(application, fixture, {allowInstall = false} = {}) {
  return application.evaluate(({net}, config) => {
    if (globalThis.__cbimLocalUpdateFixture) throw Error('Test transport already attached');
    const local = new URL(config.origin);
    if (local.hostname !== '127.0.0.1' || local.protocol !== 'http:') throw Error('Loopback endpoint required');
    const state = {routedFetch: 0, routedNet: 0, installationAttempts: 0, allowInstall: config.allowInstall};
    globalThis.__cbimLocalUpdateFixture = state;
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.hostname !== 'api.github.com') return originalFetch(input, options);
      if (url.protocol !== 'https:' || url.pathname !== '/repos/nan023062/cbim/releases' || (options?.method ?? 'GET') !== 'GET') throw Error('Unexpected GitHub request in update fixture');
      state.routedFetch++;
      return originalFetch(config.origin + url.pathname + url.search, options);
    };
    const originalRequest = net.request.bind(net);
    net.request = options => {
      const url = typeof options === 'string' ? new URL(options) : options.url ? new URL(options.url) : new URL(`${options.protocol ?? 'https:'}//${options.hostname ?? options.host}${options.path}`);
      if (url.hostname !== 'github.com') return originalRequest(options);
      if (url.protocol !== 'https:' || !config.allowedPaths.includes(url.pathname)) throw Error('Unexpected GitHub asset in update fixture');
      state.routedNet++;
      const mapped = {...(typeof options === 'object' ? options : {}), protocol: 'http:', hostname: '127.0.0.1', port: Number(local.port), path: url.pathname + url.search};
      delete mapped.url; delete mapped.host;
      return originalRequest(mapped);
    };
    const childProcess = process.getBuiltinModule('child_process');
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = function(file, ...args) {
      if (/(?:^|[\\/])CBIM-Setup-[^\\/]+\.exe$/i.test(String(file))) {
        state.installationAttempts++;
        if (!config.allowInstall) throw Error('Installer blocked by download-only test harness');
      }
      return originalSpawn.call(this, file, ...args);
    };
    return {attached: true, origin: config.origin, allowInstall: config.allowInstall};
  }, {origin: fixture.origin, allowedPaths: fixture.allowedPaths, allowInstall});
}

export function payloadSummary(fixture, b) {
  const pathname = `/nan023062/cbim/releases/download/desktop-v${b.version}/CBIM-Setup-${b.version}-x64.exe`;
  const payloads = fixture.requests.filter(item => item.path === pathname);
  return {
    fullBytes: b.receipt.artifacts[0].size,
    transferredBytes: payloads.reduce((total, item) => total + item.bytes, 0),
    ranges: payloads.filter(item => item.status === 206).length,
    fullDownloads: payloads.filter(item => item.status === 200).length,
    allResponsesComplete: payloads.every(item => item.complete),
  };
}
