/* EduVerse Vision Lab · Feature 4: Hand Tracking Playground
 *
 * Loaded after app.js. It plugs into the existing Vision Lab without editing app.js:
 *   - registers a new experiment card ("hand-playground")
 *   - wraps cvLabDemo() to supply this experiment's markup
 *   - polls the local Python service (POST /hands) for real MediaPipe landmarks
 *
 * It also exposes window.HandMath, a JavaScript port of opencv-drawing/gestures.py, used by the
 * "no camera" explorer. The same rules run on both sides; scripts/check-parity.js proves they agree.
 */
(function () {
  'use strict';
  const LAB_ID = 'hand-playground';

  // ---- Landmark geometry (port of gestures.py) ------------------------------------------------
  const NAMES = ['Wrist', 'Thumb CMC', 'Thumb MCP', 'Thumb IP', 'Thumb tip', 'Index MCP', 'Index PIP', 'Index DIP', 'Index tip',
    'Middle MCP', 'Middle PIP', 'Middle DIP', 'Middle tip', 'Ring MCP', 'Ring PIP', 'Ring DIP', 'Ring tip',
    'Pinky MCP', 'Pinky PIP', 'Pinky DIP', 'Pinky tip'];
  const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
  const FINGERS = [['index', 6, 8], ['middle', 10, 12], ['ring', 14, 16], ['pinky', 18, 20]];
  const EXTENDED_RATIO = 1.2, PINCH_RATIO = 0.25, PINCH_MIN_REACH = 1.0;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const handSize = lm => Math.max(dist(lm[0], lm[9]), 1e-6);
  const pinchRatio = lm => dist(lm[4], lm[8]) / handSize(lm);

  function fingerStates(lm) {
    const ratios = {}, states = {};
    for (const [name, pip, tip] of FINGERS) {
      ratios[name] = dist(lm[tip], lm[0]) / Math.max(dist(lm[pip], lm[0]), 1e-6);
      states[name] = ratios[name] > EXTENDED_RATIO;
    }
    const size = handSize(lm);
    const dx = (lm[4][0] - lm[2][0]) / size, dy = (lm[4][1] - lm[2][1]) / size;
    states.thumb = dist(lm[4], lm[17]) > dist(lm[3], lm[17]) * 1.1 && dist(lm[4], lm[5]) / size > 0.55;
    return { states, ratios, thumb: { dx, dy } };
  }

  function classify(lm) {
    const { states: s, ratios, thumb } = fingerStates(lm);
    const pinch = pinchRatio(lm), reach = dist(lm[8], lm[0]) / handSize(lm);
    const up = ['index', 'middle', 'ring', 'pinky'].filter(n => s[n]);
    const margin = names => names.reduce((t, n) => t + Math.min(1, Math.abs(ratios[n] - EXTENDED_RATIO) / 0.25), 0) / (names.length || 1);
    const all = ['index', 'middle', 'ring', 'pinky'];
    const out = (label, conf) => ({ label, confidence: Math.round(Math.min(1, conf) * 100) / 100, pinchRatio: Math.round(pinch * 1000) / 1000, pinch: label === 'PINCH', fingers: s });
    if (pinch < PINCH_RATIO && reach > PINCH_MIN_REACH) return out('PINCH', 0.6 + 0.4 * Math.min(1, (PINCH_RATIO - pinch) / PINCH_RATIO));
    if (up.length === 4 && s.thumb) return out('OPEN_PALM', 0.55 + 0.45 * margin(up));
    if (!up.length) {
      if (s.thumb && Math.abs(thumb.dy) > Math.abs(thumb.dx) && Math.abs(thumb.dy) > 0.6) {
        return out(thumb.dy < 0 ? 'THUMBS_UP' : 'THUMBS_DOWN', 0.6 + 0.4 * Math.min(1, (Math.abs(thumb.dy) - 0.6) / 0.6));
      }
      return out('FIST', 0.55 + 0.45 * margin(all));
    }
    if (up.length === 1 && up[0] === 'index') return out('ONE_FINGER', 0.55 + 0.45 * margin(all));
    if (up.length === 2 && up[0] === 'index' && up[1] === 'middle') return out('TWO_FINGERS', 0.55 + 0.45 * margin(all));
    return out('UNKNOWN', 0.3);
  }

  function normalize(lm) {
    const size = handSize(lm), w = lm[0];
    return lm.flatMap(p => [(p[0] - w[0]) / size, (p[1] - w[1]) / size, ((p[2] || 0) - (w[2] || 0)) / size]);
  }

  // Synthetic upright hand used by the "no camera" explorer (same construction as the Python tests).
  const MCP_X = { index: 0.44, middle: 0.50, ring: 0.56, pinky: 0.62 };
  const LM_IDX = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };
  function makeHand({ index = false, middle = false, ring = false, pinky = false, thumb = 'tucked', pinch = false } = {}) {
    const lm = Array.from({ length: 21 }, () => [0.5, 0.8, 0]);
    for (const [name, up] of [['index', index], ['middle', middle], ['ring', ring], ['pinky', pinky]]) {
      const x = MCP_X[name], [mcp, pip, dip, tip] = LM_IDX[name];
      lm[mcp] = [x, 0.60, 0];
      [lm[pip], lm[dip], lm[tip]] = up ? [[x, 0.53, 0], [x, 0.48, 0], [x, 0.44, 0]] : [[x, 0.54, 0], [x, 0.59, 0], [x, 0.64, 0]];
    }
    lm[1] = [0.45, 0.76, 0]; lm[2] = [0.42, 0.70, 0];
    const thumbs = { tucked: [[0.44, 0.67, 0], [0.46, 0.66, 0]], out: [[0.36, 0.65, 0], [0.30, 0.60, 0]], up: [[0.41, 0.58, 0], [0.40, 0.44, 0]], down: [[0.41, 0.82, 0], [0.40, 0.96, 0]] };
    [lm[3], lm[4]] = thumbs[thumb];
    if (pinch) lm[4] = [lm[8][0] - 0.02, lm[8][1] + 0.01, 0];
    return lm;
  }
  function transform(lm, angleDeg = 0, scale = 1, dx = 0, dy = 0) {
    const a = angleDeg * Math.PI / 180, [cx, cy] = lm[0];
    return lm.map(([x, y, z]) => [cx + ((x - cx) * Math.cos(a) - (y - cy) * Math.sin(a)) * scale + dx,
      cy + ((x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)) * scale + dy, (z || 0) * scale]);
  }
  const POSES = {
    'Open palm': { index: true, middle: true, ring: true, pinky: true, thumb: 'out' },
    'Fist': {}, 'One finger': { index: true }, 'Two fingers': { index: true, middle: true },
    'Thumbs up': { thumb: 'up' }, 'Thumbs down': { thumb: 'down' },
    'Pinch': { index: true, middle: true, ring: true, pinky: true, pinch: true },
  };
  window.HandMath = { NAMES, BONES, classify, normalize, pinchRatio, makeHand, transform, POSES };

  // ---- Register the experiment card ------------------------------------------------------------
  if (typeof cvLabs !== 'undefined' && !cvLabs.some(l => l[0] === LAB_ID)) {
    cvLabs.splice(1, 0, [LAB_ID, '✋', 'Hand Tracking Playground',
      'See the 21 hand landmarks MediaPipe finds, plus live coordinates, FPS and confidence.', 'MEDIAPIPE · PYTHON', 'vision', 'Beginner', '8 min']);
    cvGroupIds.vision.splice(1, 0, LAB_ID);
  }

  // ---- Experiment markup -----------------------------------------------------------------------
  const poseButtons = Object.keys(POSES).map(n => `<button class="filter-select" data-hp-pose="${n}">${n}</button>`).join('');
  const markup = `<h2 id="modalTitle">Hand tracking playground</h2>
  <p>A model finds <b>21 landmarks</b> on your hand in every camera frame. Each landmark is an (x, y, z) point, and simple geometry on those points is enough to recognise gestures. Try an open palm, a fist and a pinch.</p>
  <div class="hp-layout">
    <div>
      <div class="hp-stage" id="hpStage"><video id="cvCameraVideo" autoplay playsinline muted></video><canvas id="hpCanvas" aria-label="Hand landmark overlay"></canvas><div id="cvCameraOverlay">Start the camera to see your hand landmarks</div></div>
      <div class="cv-control-row"><button id="cvCameraStart" class="primary-btn">Start camera</button><button id="cvCameraStop" class="filter-select" disabled>Stop</button><button id="hpRecheck" class="filter-select">Re-check tracker</button></div>
      <div id="cvCameraStatus" class="cv-feedback" role="status">Camera is off. Your browser asks permission after Start. Frames stay on this computer.</div>
      <div id="hpNotice" class="cv-feedback" role="status" hidden></div>
    </div>
    <div class="hp-panel">
      <div class="hp-stats" id="hpStats" aria-live="polite">
        <div><small>Hand detected</small><b id="hpDetected">—</b></div><div><small>Landmarks</small><b id="hpCount">0</b></div>
        <div><small>Confidence</small><b id="hpConf">—</b></div><div><small>FPS</small><b id="hpFps">—</b></div>
        <div><small>Gesture</small><b id="hpGesture">—</b></div><div><small>Pinch ratio</small><b id="hpPinch">—</b></div>
      </div>
      <table class="hp-table"><caption>Fingertip coordinates (0–1)</caption><thead><tr><th>Landmark</th><th>x</th><th>y</th><th>z</th></tr></thead><tbody id="hpTips"></tbody></table>
      <small id="hpMotion" class="hp-motion">Hand speed: —</small>
    </div>
  </div>
  <div class="hp-challenge"><b>Challenge</b> Show an <span data-hp-goal="OPEN_PALM">open palm</span>, a <span data-hp-goal="FIST">fist</span> and a <span data-hp-goal="PINCH">pinch</span> (confidence 70%+). <span id="hpGoalStatus">0 / 3</span></div>
  <details class="hp-explorer" id="hpExplorer"><summary>Use mouse/keyboard instead — explore a model hand</summary>
    <p class="panel-copy">No camera needed. Pick a pose, then rotate and resize the hand. The gesture rules use distances, so the label survives any rotation or size. The normalised features ignore position and size but not rotation, so hold your hand upright when you train a gesture. Click a landmark to read it.</p>
    <div class="cv-control-row">${poseButtons}</div>
    <canvas id="hpExplorerCanvas" width="360" height="300" tabindex="0" aria-label="Model hand with 21 landmarks"></canvas>
    <label class="cv-slider">Rotate <input id="hpRotate" type="range" min="0" max="359" value="0"><span id="hpRotateVal">0°</span></label>
    <label class="cv-slider">Size <input id="hpScale" type="range" min="40" max="160" value="100"><span id="hpScaleVal">100%</span></label>
    <div id="hpExplorerOut" class="cv-feedback" role="status">Choose a pose.</div>
  </details>
  <div class="hp-how"><b>How it works</b> Camera → OpenCV decodes the frame → MediaPipe finds the hand → 21 landmarks → geometry rules (finger tip vs. knuckle distance from the wrist) → gesture + confidence.</div>
  <div id="hpResult" class="cv-feedback" role="status"></div>`;

  if (typeof cvLabDemo === 'function') {
    const original = cvLabDemo;
    window.cvLabDemo = function (id) { return id === LAB_ID ? markup : original(id); };
  }

  // ---- Drawing ----------------------------------------------------------------------------------
  function drawHand(canvas, lm, { highlight = -1, color = '#7b61dc' } = {}) {
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!lm) return;
    ctx.lineWidth = 2.5; ctx.strokeStyle = color; ctx.lineCap = 'round';
    for (const [a, b] of BONES) { ctx.beginPath(); ctx.moveTo(lm[a][0] * w, lm[a][1] * h); ctx.lineTo(lm[b][0] * w, lm[b][1] * h); ctx.stroke(); }
    lm.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p[0] * w, p[1] * h, i === highlight ? 6 : [4, 8, 12, 16, 20].includes(i) ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = i === highlight ? '#ffb020' : [4, 8, 12, 16, 20].includes(i) ? '#ffe27a' : '#ffffff'; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    });
  }

  // ---- Challenge tracking (validated against real classifier output) ---------------------------
  const seen = new Set(); let completedSaved = false;
  function noteGesture(label, confidence, source) {
    if (!['OPEN_PALM', 'FIST', 'PINCH'].includes(label) || confidence < 0.7) return;
    seen.add(label);
    document.querySelectorAll('[data-hp-goal]').forEach(el => el.classList.toggle('hp-done', seen.has(el.dataset.hpGoal)));
    const status = document.querySelector('#hpGoalStatus'); if (status) status.textContent = `${seen.size} / 3`;
    if (seen.size === 3 && !completedSaved) {
      completedSaved = true;
      if (status) status.textContent = '3 / 3 · Experiment complete ✓';
      if (typeof saveVisionProgress === 'function') saveVisionProgress(LAB_ID, 'completed', source === 'camera' ? 100 : 70, '#hpResult');
    }
  }

  // ---- Live landmark loop -----------------------------------------------------------------------
  let busy = false, trackerChecked = false, trackerOk = false, lastWrist = null, lastWristT = 0, fpsEma = 0, lastTick = 0, emptySince = 0;
  const $ = s => document.querySelector(s);
  const setText = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
  function notice(msg) { const n = $('#hpNotice'); if (!n) return; n.hidden = !msg; n.textContent = msg || ''; }

  async function checkTracker() {
    trackerChecked = true;
    try {
      const r = await fetch(`${OPENCV_URL}/hands/status`); const s = await r.json();
      trackerOk = !!s.available;
      notice(trackerOk ? '' : `Real hand landmarks are not enabled yet. ${s.reason || ''} You can still use the model-hand explorer below.`);
    } catch {
      trackerOk = false;
      notice('The Python tracker is not running. Start it with: python3 server.py (inside opencv-drawing). You can still use the model-hand explorer below.');
    }
  }

  async function tick() {
    const canvas = $('#hpCanvas');
    if (!canvas || cvCurrentLab !== LAB_ID || !cvStream || busy) return;
    if (!trackerChecked) await checkTracker();
    if (!trackerOk) return;
    const video = $('#cvCameraVideo');
    if (video && video.videoWidth && canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; $('#hpStage').style.aspectRatio = `${video.videoWidth}/${video.videoHeight}`; }
    busy = true;
    try {
      const blob = await frameFromCamera(); if (!blob) return;
      const r = await fetch(`${OPENCV_URL}/hands`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Tracker error');
      if (data.available === false) { trackerOk = false; notice(data.reason || 'Hand tracking is unavailable.'); return; }
      const now = performance.now(); if (lastTick) { const inst = 1000 / (now - lastTick); fpsEma = fpsEma ? fpsEma * 0.8 + inst * 0.2 : inst; } lastTick = now;
      setText('#hpFps', fpsEma ? fpsEma.toFixed(1) : '—');
      const hand = data.hands && data.hands[0];
      if (!hand) {
        drawHand(canvas, null); setText('#hpDetected', 'No'); setText('#hpCount', '0'); setText('#hpGesture', '—'); setText('#hpConf', '—'); setText('#hpPinch', '—');
        $('#hpTips').innerHTML = ''; lastWrist = null;
        emptySince = emptySince || Date.now();
        notice(Date.now() - emptySince > 2500 ? 'Your camera is connected, but we cannot see your hand. Move it into the frame, face your palm to the camera, and check the lighting.' : '');
        return;
      }
      emptySince = 0; notice(fpsEma && fpsEma < 5 ? `Low frame rate (${fpsEma.toFixed(1)} FPS). Close other camera apps or move to a brighter room.` : '');
      drawHand(canvas, hand.landmarks);
      setText('#hpDetected', 'Yes'); setText('#hpCount', String(hand.landmarks.length));
      setText('#hpConf', `${Math.round((hand.score ?? 0) * 100)}%`);
      setText('#hpGesture', `${hand.gesture.replace('_', ' ')} · ${Math.round(hand.gestureConfidence * 100)}%`);
      setText('#hpPinch', hand.pinchRatio.toFixed(2));
      $('#hpTips').innerHTML = [4, 8, 12, 16, 20].map(i => `<tr><td>${NAMES[i]}</td><td>${hand.landmarks[i][0].toFixed(2)}</td><td>${hand.landmarks[i][1].toFixed(2)}</td><td>${hand.landmarks[i][2].toFixed(2)}</td></tr>`).join('');
      const w = hand.landmarks[0], t = now;
      if (lastWrist) setText('#hpMotion', `Hand speed: ${(Math.hypot(w[0] - lastWrist[0], w[1] - lastWrist[1]) / ((t - lastWristT) / 1000)).toFixed(2)} frame-widths/s`);
      lastWrist = w; lastWristT = t;
      noteGesture(hand.gesture, hand.gestureConfidence, 'camera');
    } catch (err) {
      notice(`Tracking paused: ${err.message}. Is the Python service still running?`);
    } finally { busy = false; }
  }
  setInterval(tick, 70);

  // ---- Explorer + delegated events --------------------------------------------------------------
  let pose = null, shown = null;
  function paintExplorer(highlight = -1) {
    const canvas = $('#hpExplorerCanvas'); if (!canvas || !pose) return;
    const angle = +$('#hpRotate').value, scale = +$('#hpScale').value / 100;
    shown = transform(makeHand(POSES[pose]), angle, scale, 0, 0);
    // Re-centre so rotating / scaling never pushes the hand out of the canvas.
    const cx = shown[9][0], cy = shown[9][1]; shown = shown.map(p => [p[0] - cx + 0.5, p[1] - cy + 0.5, p[2]]);
    drawHand(canvas, shown, { highlight });
    const v = classify(shown), f = normalize(shown);
    setText('#hpRotateVal', `${angle}°`); setText('#hpScaleVal', `${Math.round(scale * 100)}%`);
    setText('#hpExplorerOut', `Gesture: ${v.label.replace('_', ' ')} (${Math.round(v.confidence * 100)}%) · pinch ratio ${v.pinchRatio} · index-tip feature (${f[24].toFixed(2)}, ${f[25].toFixed(2)}): unchanged by size, changed by rotation.${highlight >= 0 ? ` · ${highlight}: ${NAMES[highlight]} at (${shown[highlight][0].toFixed(2)}, ${shown[highlight][1].toFixed(2)})` : ''}`);
    noteGesture(v.label, v.confidence, 'explorer');
  }
  document.addEventListener('click', e => {
    const p = e.target.closest && e.target.closest('[data-hp-pose]');
    if (p) { pose = p.dataset.hpPose; paintExplorer(); return; }
    if (e.target.id === 'hpRecheck') { trackerChecked = false; notice('Checking…'); checkTracker(); return; }
    if (e.target.id === 'hpExplorerCanvas' && shown) {
      const rect = e.target.getBoundingClientRect(), x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
      let best = 0, bd = 9; shown.forEach((q, i) => { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = i; } });
      paintExplorer(best);
    }
    if (e.target.id === 'cvCameraStart' && cvCurrentLab === LAB_ID) { trackerChecked = false; }
  });
  document.addEventListener('input', e => { if (e.target.id === 'hpRotate' || e.target.id === 'hpScale') paintExplorer(); });
  document.addEventListener('keydown', e => {
    if (e.target.id === 'hpExplorerCanvas' && shown && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const cur = +($('#hpExplorerOut').dataset.sel || 0), next = (cur + (e.key === 'ArrowRight' ? 1 : 20)) % 21;
      $('#hpExplorerOut').dataset.sel = next; paintExplorer(next); e.preventDefault();
    }
  });
})();
