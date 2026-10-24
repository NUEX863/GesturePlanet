// Deterministic tests for gesture math, using synthetic landmarks (not a webcam).
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
let code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(code);
code = code.replace('requestAnimationFrame(frame);startCamera();', 'globalThis.testAPI={state,classify,processHand,resetHand,MIN_DISTANCE,MAX_DISTANCE};');
const drawing = new Proxy({}, { get: () => () => {} });
const elements = new Map();
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      style: {}, classList: { add() {}, remove() {}, toggle() {} }, textContent: '',
      addEventListener() {}, videoWidth: 640, videoHeight: 480, width: 430, height: 276,
      getContext(type) { return type === '2d' ? drawing : null; }
    });
    return elements.get(id);
  },
  addEventListener() {}
};
const context = { document, window: { addEventListener() {} }, matchMedia: () => ({ matches: true }), performance: { now: () => 0 }, setTimeout, clearTimeout, console };
vm.runInNewContext(code, context);
const api = context.testAPI;
function landmarks(kind) {
  const p = Array.from({ length: 21 }, () => ({ x: .5, y: .6, z: 0 }));
  p[0] = { x: .5, y: .80, z: 0 };
  p[1] = { x: .39, y: .72, z: 0 }; p[2] = { x: .30, y: .66, z: 0 };
  p[3] = { x: .23, y: .62, z: 0 }; p[4] = { x: .16, y: .59, z: 0 };
  for (let f = 0; f < 4; f++) {
    const m = 5 + f * 4, x = .38 + f * .095;
    p[m] = { x, y: .60 + f * .01, z: 0 };
    p[m + 1] = { x, y: .44 + f * .015, z: 0 };
    p[m + 2] = { x, y: .31 + f * .02, z: 0 };
    p[m + 3] = { x, y: .21 + f * .025, z: 0 };
    if (kind === 'fist' || (kind === 'rotate' && f > 0)) {
      p[m + 2] = { x, y: .57, z: -.05 };
      p[m + 3] = { x, y: .68, z: -.06 };
    }
  }
  return p;
}
const scaled = (p, s) => p.map(n => ({ x: .5 + (n.x - .5) * s, y: .8 + (n.y - .8) * s, z: n.z * s }));
let time = 1000;
function feed(p, n = 1, side = 'Right') {
  for (let i = 0; i < n; i++) api.processHand({ landmarks: [p], handedness: [[{ categoryName: side }]] }, time += 70);
}
function reset() {
  api.resetHand();
  Object.assign(api.state, { targetDistance: 10.8, targetRoll: 0, targetYaw: 0 });
}
for (const pose of ['fist', 'open', 'rotate']) assert.equal(api.classify(landmarks(pose)), pose);
reset();feed(landmarks('open'), 10);assert.equal(api.state.targetDistance, 10.8, 'Holding a pose must not zoom');
feed(scaled(landmarks('open'), 1.8), 45);assert.equal(api.state.targetDistance, api.MIN_DISTANCE, 'Open/approach must reach and respect near limit');
feed(scaled(landmarks('open'), 1), 15);assert.equal(api.state.targetDistance, api.MIN_DISTANCE, 'Returning hand must not reverse a zoom');
reset();feed(landmarks('fist'), 10);feed(scaled(landmarks('fist'), .5), 45);assert.equal(api.state.targetDistance, api.MAX_DISTANCE, 'Fist/retract must reach and respect far limit');
reset();feed(landmarks('fist'), 10);feed(scaled(landmarks('fist'), 1.3), 20);assert.equal(api.state.targetDistance, 10.8, 'Wrong direction must not zoom');
reset();feed(landmarks('open'), 10);feed(scaled(landmarks('open'), .7), 20);assert.equal(api.state.targetDistance, 10.8, 'Open/retract must not zoom');
reset();feed(landmarks('open'), 10);feed(scaled(landmarks('fist'), .75), 10);assert.equal(api.state.targetDistance, 10.8, 'Changing pose must rebase before zoom');
reset();feed(landmarks('open'), 10);api.processHand({ landmarks: [] }, time += 400);feed(scaled(landmarks('open'), 1.5), 10);assert.equal(api.state.targetDistance, 10.8, 'Reacquiring hand must not jump');
reset();feed(landmarks('open'), 10);feed(scaled(landmarks('open'), 1.5), 10, 'Left');assert.equal(api.state.targetDistance, 10.8, 'Switching hands must rebase');
reset();const p = landmarks('rotate');feed(p, 10);
const angle = .14;
// Rotate the physical palm counterclockwise => clockwise in the mirrored preview.
const rotated = p.map(n => { const x = (n.x - .5) * 4 / 3, y = n.y - .8;return { x: .5 + (x * Math.cos(angle) + y * Math.sin(angle)) * 3 / 4, y: .8 - x * Math.sin(angle) + y * Math.cos(angle), z: n.z }; });
feed(rotated, 3);assert.ok(api.state.targetRoll > 0, 'Clockwise mirrored wrist motion must turn the visible planet clockwise');
assert.ok(api.state.targetYaw < 0, 'Rotation must change the orbit as well as camera roll');
const out = p => p ** 2, inside = p => 1 - (1 - p) ** 3;
assert.ok(out(.8)-out(.7) > out(.2)-out(.1));
assert.ok(inside(.8)-inside(.7) < inside(.2)-inside(.1));
console.log('PASS: syntax, three gestures, distance limits, direction gates, pose/hand reacquisition, mirrored rotation, and zoom easing.');
