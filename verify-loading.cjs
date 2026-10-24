// Regression checks for complete self-hosted assets, failure reporting and cancellation.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(
  'requestAnimationFrame(frame);startCamera();',
  'globalThis.testAPI={HAND_FILES,fetchHandAsset,prepareHandAssets,bounded,handAssets};'
);
const elements = new Map();
const drawing = new Proxy({}, { get: () => () => {} });
const document = {
  baseURI: 'https://example.github.io/Planet/',
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      style: {}, classList: { add() {}, remove() {}, toggle() {} }, textContent: '',
      addEventListener() {}, getContext(type) { return type === '2d' ? drawing : null; }
    });
    return elements.get(id);
  },
  addEventListener() {}
};
const context = {
  document, window: { addEventListener() {} }, location: { protocol: 'https:' },
  matchMedia: () => ({ matches: true }), performance: { now: () => 0 },
  setTimeout, clearTimeout, console: { warn() {}, info() {} },
  URL, Blob, AbortController, DOMException, crypto: webcrypto, btoa, WebAssembly,
  fetch: (...args) => mockFetch(...args)
};
let mockFetch;
vm.runInNewContext(code, context);
const api = context.testAPI;
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets/mediapipe-hands/manifest.json')));
async function main() {
  let bytesTotal = 0;
  for (const file of api.HAND_FILES) {
    const bytes = fs.readFileSync(path.join(__dirname, 'assets/mediapipe-hands', file.name));
    assert.equal(bytes.length, file.size, file.name + ': size');
    assert.equal(createHash('sha256').update(bytes).digest('base64'), file.hash, file.name + ': SHA-256');
    const entry = manifest.files.find(item => item.name === file.name);
    assert.equal(entry?.hash, file.hash, 'Runtime and disk manifest must agree');
    bytesTotal += bytes.length;
  }
  assert.equal(manifest.files.length, api.HAND_FILES.length);
  const sdk = fs.readFileSync(path.join(__dirname, 'assets/mediapipe-hands/hands.js'), 'utf8');
  for (const name of ['hands.binarypb', 'hands_solution_packed_assets_loader.js', 'hands_solution_simd_wasm_bin.js', 'hands_solution_wasm_bin.js']) {
    assert.ok(sdk.includes(name));
    assert.ok(api.HAND_FILES.some(file => file.name === name), 'Every SDK startup dependency must be preloaded');
  }
  const bytes = Buffer.from('verified model fixture');
  const fixture = { name: 'fixture.data', size: bytes.length, hash: createHash('sha256').update(bytes).digest('base64') };
  let calls = 0;
  mockFetch = async url => {
    calls++;
    assert.equal(url, 'https://example.github.io/Planet/assets/mediapipe-hands/fixture.data', 'Preserve GitHub repository path');
    return new Response(bytes);
  };
  const asset = await api.fetchHandAsset(fixture, new AbortController().signal, () => {});
  assert.equal(await asset.text(), bytes.toString());
  assert.equal(calls, 1);
  calls = 0;
  mockFetch = async () => { calls++; return new Response('not found', { status: 404 }); };
  await assert.rejects(api.fetchHandAsset(fixture, new AbortController().signal, () => {}), /fixture.data.*404/);
  assert.equal(calls, 1, 'Missing deployment files fail immediately');
  calls = 0;
  mockFetch = async (_, options) => {
    calls++;
    if (calls === 2) assert.equal(options.cache, 'reload');
    return new Response(calls === 1 ? Buffer.alloc(bytes.length) : bytes);
  };
  await api.fetchHandAsset(fixture, new AbortController().signal, () => {});
  assert.equal(calls, 2, 'Corrupt cached responses must retry without the cache');
  calls = 0;
  mockFetch = async () => { calls++; throw new Error('network'); };
  await assert.rejects(api.fetchHandAsset(fixture, new AbortController().signal, () => {}), /fixture.data.*下载失败/);
  assert.equal(calls, 2, 'Network failures must be bounded');
  let pendingSignal;
  mockFetch = (_, { signal }) => { pendingSignal = signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); };
  const controller = new AbortController();
  const pending = api.fetchHandAsset(fixture, controller.signal, () => {});
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(pendingSignal.aborted, true, 'Closing the camera cancels network traffic');
  const alreadyAborted = new AbortController();alreadyAborted.abort();
  await assert.rejects(api.fetchHandAsset(fixture, alreadyAborted.signal, () => {}), { name: 'AbortError' });
  await assert.rejects(api.bounded(new Promise(() => {}), 5, '初始化超时'), /初始化超时/);
  const cancelled = new AbortController();
  const waiting = api.bounded(new Promise(() => {}), 1000, 'timeout', cancelled.signal);
  cancelled.abort();await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(await api.bounded(Promise.resolve('retry works'), 50, 'timeout'), 'retry works');
  context.location.protocol = 'file:';
  await assert.rejects(api.prepareHandAssets(new AbortController().signal), /本地预览或 GitHub Pages/);
  console.log(`PASS: ${manifest.files.length} packaged resources (${bytesTotal} bytes), SHA-256, complete SDK dependencies, GitHub subpath, 404, corrupt-cache retry, network failure, cancellation, startup timeout and file URL guidance.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
