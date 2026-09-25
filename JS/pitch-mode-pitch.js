// ============================================================
// pitch-mode-pitch.js
// PITCHMODE：ピッチロール表示・録音・スコア判定。
//
// 【移植元】旧QNPITCH(app.js)のロール描画・マイク解析・REC/PLAY/SAVE・
// 録音一覧を移植。ピッチ検出はpitch-core.js、フィルタ/スコア判定は
// pitch-filters.js、永続化はpitch-recordings.jsに分離済み。
//
// 【今回のスコープ外（次回以降に実装）】KEY&DRONE、内蔵メトロノーム、
// ピンチズーム、ノートラベルのタップ発音。
// ============================================================

window.QNPitch = window.QNPitch || {};

(function () {
  const FULL_RANGE = { min: 24, max: 108 };
  const VISIBLE_ROWS = 22;
  const PIXELS_PER_SEC = 60;
  const INITIAL_BUFFER_SEC = 30;
  const INITIAL_FOCUS = { min: 48, max: 72 };

  let ROW_HEIGHT = 22;
  let canvasHeight = 0;
  let canvasWidth = 0;

  function totalRows() {
    return FULL_RANGE.max - FULL_RANGE.min + 1;
  }
  function midiToY(midi) {
    const clamped = Math.max(FULL_RANGE.min, Math.min(FULL_RANGE.max, midi));
    return (FULL_RANGE.max - clamped) * ROW_HEIGHT;
  }

  // ==================== 状態 ====================
  let pitchTrack = [];
  let startTime = 0;
  let recording = false;
  let pendingRecording = null;
  let currentPlayback = null;

  let micSession = null;
  let mediaRecorder = null;
  let recordedChunks = [];

  let canvas = null, ctx = null;
  let volumeCanvas = null, volCtx = null;
  let rollScroll = null, rollKeys = null, rollContent = null;
  let volumeScroll = null;
  let cursorEl = null;

  function getCore() {
    return window.QNPitch.core;
  }

  // ==================== キャンバスサイズ ====================
  function setupSize() {
    if (!rollScroll) return;
    const panelHeight = rollScroll.parentElement.clientHeight || 320;
    ROW_HEIGHT = Math.max(14, Math.floor(panelHeight / VISIBLE_ROWS));
    canvasHeight = totalRows() * ROW_HEIGHT;

    if (canvasWidth < PIXELS_PER_SEC * INITIAL_BUFFER_SEC) {
      canvasWidth = PIXELS_PER_SEC * INITIAL_BUFFER_SEC;
    }
    canvas.height = canvasHeight;
    canvas.width = canvasWidth;
    canvas.style.height = canvasHeight + 'px';

    if (volumeCanvas) {
      volumeCanvas.width = canvasWidth;
      volumeCanvas.height = volumeCanvas.parentElement.clientHeight || 72;
    }

    rollKeys.innerHTML = '';
    const core = getCore();
    for (let m = FULL_RANGE.min; m <= FULL_RANGE.max; m++) {
      const y = midiToY(m);
      const noteName = core.NOTE_NAMES[((m % 12) + 12) % 12];
      const isSharp = noteName.includes('#');
      const isC = noteName === 'C';
      const label = document.createElement('div');
      label.className = 'pitch-roll-key-label' + (isSharp ? ' sharp' : '') + (isC ? ' is-c' : '');
      label.style.top = y + 'px';
      label.style.height = ROW_HEIGHT + 'px';
      label.textContent = core.midiToNoteName(m);
      rollKeys.appendChild(label);
    }
    rollKeys.scrollTop = rollScroll.scrollTop;
  }

  function scrollToRange(range) {
    const panelHeight = rollScroll.parentElement.clientHeight || 320;
    const centerMidi = (range.min + range.max) / 2;
    const centerY = midiToY(centerMidi);
    const target = centerY - panelHeight / 2 + ROW_HEIGHT / 2;
    const maxScroll = canvasHeight - panelHeight;
    rollScroll.scrollTop = Math.max(0, Math.min(maxScroll, target));
    rollKeys.scrollTop = rollScroll.scrollTop;
  }

  // ==================== 描画 ====================
  function drawBackground() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    const core = getCore();
    for (let m = FULL_RANGE.min; m <= FULL_RANGE.max; m++) {
      const y = midiToY(m);
      const noteName = core.NOTE_NAMES[((m % 12) + 12) % 12];
      const isSharp = noteName.includes('#');
      const isC = noteName === 'C';

      ctx.fillStyle = isSharp ? '#1a1a22' : '#1e1e28';
      ctx.fillRect(0, y, canvasWidth, ROW_HEIGHT);

      ctx.strokeStyle = isC ? 'rgba(59,130,246,0.28)' : '#2a2a34';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }
  }

  function drawVolumeLine() {
    if (!volumeCanvas) return;
    const w = volumeCanvas.width;
    const h = volumeCanvas.height;
    volCtx.clearRect(0, 0, w, h);

    volCtx.strokeStyle = 'rgba(255,255,255,0.08)';
    volCtx.lineWidth = 1;
    volCtx.beginPath();
    volCtx.moveTo(0, h - 1);
    volCtx.lineTo(w, h - 1);
    volCtx.stroke();

    if (pitchTrack.length < 2) return;

    volCtx.lineWidth = 1.5;
    volCtx.lineCap = 'round';
    volCtx.strokeStyle = '#60a5fa';
    volCtx.beginPath();
    let started = false;
    for (let i = 0; i < pitchTrack.length; i++) {
      const p = pitchTrack[i];
      const rms = p.rms || 0;
      const level = Math.max(0, Math.min(1, rms * 4));
      const x = p.t * PIXELS_PER_SEC;
      const y = h - level * (h - 2) - 1;
      if (!started) { volCtx.moveTo(x, y); started = true; }
      else { volCtx.lineTo(x, y); }
    }
    volCtx.stroke();
  }

  function ensureCursorEl() {
    if (!cursorEl && rollContent) {
      cursorEl = document.createElement('div');
      cursorEl.className = 'pitch-playback-cursor';
      rollContent.appendChild(cursorEl);
    }
    return cursorEl;
  }
  function drawCursor() {
    const el = ensureCursorEl();
    if (!el) return;
    if (currentPlayback && !currentPlayback.audio.paused) {
      const x = currentPlayback.audio.currentTime * PIXELS_PER_SEC;
      el.style.left = x + 'px';
      el.classList.add('active');
    }
  }
  function hideCursor() {
    if (cursorEl) cursorEl.classList.remove('active');
  }

  function redraw() {
    if (!ctx) return;
    drawBackground();

    if (pitchTrack.length < 2) { drawVolumeLine(); return; }

    const filters = window.QNPitch.filters;
    const track = filters.applyFilters(pitchTrack);

    const vibratoRegions = filters.detectVibratoRegions(track);
    if (vibratoRegions.length) {
      ctx.fillStyle = 'rgba(167, 139, 250, 0.18)';
      vibratoRegions.forEach(function (r) {
        const x1 = r.startT * PIXELS_PER_SEC;
        const x2 = r.endT * PIXELS_PER_SEC;
        ctx.fillRect(x1, 0, Math.max(2, x2 - x1), canvasHeight);
      });
    }

    const driftRegions = filters.detectDriftRegions(track);
    if (driftRegions.length) {
      ctx.fillStyle = 'rgba(248, 113, 113, 0.22)';
      driftRegions.forEach(function (r) {
        const x1 = r.startT * PIXELS_PER_SEC;
        const x2 = r.endT * PIXELS_PER_SEC;
        ctx.fillRect(x1, 0, Math.max(2, x2 - x1), canvasHeight);
      });
    }

    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < track.length; i++) {
      const p = track[i];
      if (!p.voiced) { started = false; continue; }
      const x = p.t * PIXELS_PER_SEC;
      const y = midiToY(p.midi) + ROW_HEIGHT / 2;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    for (let i = 0; i < track.length; i++) {
      const p = track[i];
      if (!p.voiced) continue;
      const x = p.t * PIXELS_PER_SEC;
      const y = midiToY(p.midi) + ROW_HEIGHT / 2;
      const absCents = Math.abs(p.cents);
      let color = '#4ade80';
      if (absCents > 30) color = '#f87171';
      else if (absCents > 12) color = '#facc15';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    drawCursor();
    drawVolumeLine();
  }

  function ensureWidth(tSeconds) {
    const needed = (tSeconds + 5) * PIXELS_PER_SEC;
    if (needed > canvasWidth) {
      canvasWidth = needed;
      canvas.width = canvasWidth;
      if (volumeCanvas) volumeCanvas.width = canvasWidth;
    }
  }

  // ==================== 録音 ====================
  function updateStatusHint(text, live) {
    const hint = document.getElementById('pitchStatusHint');
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle('live', !!live);
  }

  function updateHeaderMicBtn() {
    const btn = document.getElementById('pitchHeaderMicBtn');
    if (btn) btn.classList.toggle('mic-on', recording);
    const recBtn = document.getElementById('pitchRecBtn');
    if (recBtn) {
      recBtn.classList.toggle('is-recording', recording);
      const label = document.getElementById('pitchRecLabel');
      if (label) label.textContent = recording ? 'Stop' : 'Rec';
    }
  }

  function updateSaveBtnState() {
    const saveBtn = document.getElementById('pitchSaveBtn');
    if (saveBtn) saveBtn.disabled = !pendingRecording;
  }

  async function beginRecording() {
    pendingRecording = null;
    updateSaveBtnState();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      updateStatusHint('マイクへのアクセスが許可されませんでした', false);
      return;
    }

    const core = getCore();
    micSession = core.createAnalysisSession({
      fftSize: 2048,
      onFrame(result) {
        handleAnalysisFrame(result.freq, result.rms);
      }
    });
    await micSession.startFromMic({ audio: true }).catch(() => {});

    recording = true;
    pitchTrack = [];
    canvasWidth = PIXELS_PER_SEC * INITIAL_BUFFER_SEC;
    setupSize();
    startTime = performance.now();

    recordedChunks = [];
    const mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm')) ? 'audio/webm' : '';
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start(250);
    mediaRecorder._rawStream = stream;

    updateHeaderMicBtn();
    updateStatusHint('録音中...', true);
  }

  function handleAnalysisFrame(freq, rms) {
    if (!recording) return;
    const core = getCore();
    const t = (performance.now() - startTime) / 1000;
    if (freq > 50 && freq < 1200) {
      const midi = core.freqToMidi(freq);
      const roundedMidi = Math.round(midi);
      const cents = Math.round((midi - roundedMidi) * 100);
      const noteName = core.midiToNoteName(roundedMidi);

      const noteReadout = document.getElementById('pitchNoteReadout');
      const centsReadout = document.getElementById('pitchCentsReadout');
      if (noteReadout) noteReadout.textContent = noteName;
      if (centsReadout) {
        const absCents = Math.abs(cents);
        let cls = 'good';
        if (absCents > 30) cls = 'bad';
        else if (absCents > 12) cls = 'warn';
        centsReadout.className = 'pitch-cents-readout ' + cls;
        centsReadout.textContent = (cents > 0 ? '+' : '') + cents + ' ¢';
      }
      pitchTrack.push({ t, midi, cents, rms, voiced: true });
    } else {
      const noteReadout = document.getElementById('pitchNoteReadout');
      const centsReadout = document.getElementById('pitchCentsReadout');
      if (noteReadout) noteReadout.textContent = '--';
      if (centsReadout) { centsReadout.className = 'pitch-cents-readout'; centsReadout.textContent = '-- ¢'; }
      pitchTrack.push({ t, midi: 0, cents: 0, rms, voiced: false });
    }

    ensureWidth(t);
    redraw();
    if (rollScroll) rollScroll.scrollLeft = t * PIXELS_PER_SEC - rollScroll.clientWidth + 120;
  }

  async function endRecording() {
    if (!recording) return;
    recording = false;
    if (micSession) { micSession.stop(); micSession = null; }

    updateHeaderMicBtn();
    updateStatusHint('マイク未接続 — ヘッダーのマイクボタンで開始', false);

    const finalTrack = pitchTrack.slice();

    await new Promise((resolve) => {
      if (!mediaRecorder) { resolve(); return; }
      mediaRecorder.onstop = resolve;
      mediaRecorder.stop();
    });

    if (mediaRecorder && mediaRecorder._rawStream) {
      mediaRecorder._rawStream.getTracks().forEach(t => t.stop());
    }

    const blob = new Blob(recordedChunks, { type: (recordedChunks[0] && recordedChunks[0].type) || 'audio/webm' });
    const duration = finalTrack.length ? finalTrack[finalTrack.length - 1].t : 0;
    const rec = window.QNPitch.recordings;
    const filters = window.QNPitch.filters;
    const defaultName = rec.makeRecordingName();
    const score = filters.calcScore(filters.applyFilters(finalTrack));

    pendingRecording = { blob, pitchTrack: finalTrack, duration, score, name: defaultName };
    updateSaveBtnState();
    updateStatusHint('録音完了 — 再生できます（保存するにはSAVE）', false);
    selectRecording({ id: null, name: defaultName, blob, pitchTrack: finalTrack, duration, score });
  }

  async function handleSaveClick() {
    if (!pendingRecording) return;
    const rec = window.QNPitch.recordings;
    const chosenName = await rec.openSaveDialog(pendingRecording.name);
    if (chosenName === null) return;

    try {
      const newId = await rec.dbAddRecording({
        name: chosenName,
        blob: pendingRecording.blob,
        pitchTrack: pendingRecording.pitchTrack,
        duration: pendingRecording.duration,
        score: pendingRecording.score,
        createdAt: Date.now()
      });
      updateStatusHint('「' + chosenName + '」を保存しました', false);
      pendingRecording = null;
      updateSaveBtnState();
      if (currentPlayback) {
        currentPlayback.id = newId;
        const pbName = document.getElementById('pitchPbName');
        if (pbName) pbName.textContent = chosenName;
      }
      rec.refreshRecList();
    } catch (err) {
      console.error(err);
      updateStatusHint('保存に失敗しました', false);
    }
  }

  // ==================== 再生 ====================
  function stopPlayback() {
    if (currentPlayback) {
      currentPlayback.audio.pause();
      cancelAnimationFrame(currentPlayback.rafId);
      URL.revokeObjectURL(currentPlayback.audio.src);
      currentPlayback = null;
    }
    const pbInfoRow = document.getElementById('pitchPbInfoRow');
    const playToggleBtn = document.getElementById('pitchPlayToggleBtn');
    if (pbInfoRow) pbInfoRow.hidden = true;
    if (playToggleBtn) playToggleBtn.disabled = true;
    setPlayIcon(false);
    hideCursor();
    if (window.QNPitch.recordings) window.QNPitch.recordings.refreshRecList();
    setupSize();
    redraw();
  }

  function setPlayIcon(isPlaying) {
    const playIcon = document.getElementById('pitchPlayIcon');
    const playLabel = document.getElementById('pitchPlayLabel');
    if (playIcon) playIcon.innerHTML = isPlaying
      ? '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
    if (playLabel) playLabel.textContent = isPlaying ? 'Pause' : 'Play';
  }

  function selectRecording(rec) {
    if (recording) return;
    if (rec.id) {
      pendingRecording = null;
      updateSaveBtnState();
    }
    stopPlayback();

    const url = URL.createObjectURL(rec.blob);
    const audio = new Audio(url);
    currentPlayback = { id: rec.id, audio, rafId: null };

    pitchTrack = rec.pitchTrack;
    canvasWidth = Math.max(PIXELS_PER_SEC * INITIAL_BUFFER_SEC, (rec.duration + 5) * PIXELS_PER_SEC);

    const pbName = document.getElementById('pitchPbName');
    const pbScore = document.getElementById('pitchPbScore');
    const pbProgressFill = document.getElementById('pitchPbProgressFill');
    const pbInfoRow = document.getElementById('pitchPbInfoRow');
    const playToggleBtn = document.getElementById('pitchPlayToggleBtn');
    if (pbName) pbName.textContent = rec.name;
    if (pbScore) pbScore.textContent = (rec.score !== null && rec.score !== undefined) ? ('SCORE ' + rec.score + '%') : '';
    if (pbProgressFill) pbProgressFill.style.width = '0%';
    if (pbInfoRow) pbInfoRow.hidden = false;
    if (playToggleBtn) playToggleBtn.disabled = false;

    setupSize();
    redraw();

    audio.addEventListener('ended', function () {
      setPlayIcon(false);
      hideCursor();
    });

    audio.play();
    setPlayIcon(true);
    tickPlayback();
    if (window.QNPitch.recordings) window.QNPitch.recordings.refreshRecList();
  }

  function tickPlayback() {
    if (!currentPlayback) return;
    const audio = currentPlayback.audio;
    if (!audio.paused) {
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      const pbProgressFill = document.getElementById('pitchPbProgressFill');
      if (pbProgressFill) pbProgressFill.style.width = pct + '%';
      const x = audio.currentTime * PIXELS_PER_SEC;
      if (rollScroll) rollScroll.scrollLeft = Math.max(0, x - rollScroll.clientWidth / 2);
      drawCursor();
    }
    currentPlayback.rafId = requestAnimationFrame(tickPlayback);
  }

  // ==================== メインエリア初期化 ====================
  function initMainArea() {
    canvas = document.getElementById('pitchRollCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    volumeCanvas = document.getElementById('pitchVolumeCanvas');
    volCtx = volumeCanvas.getContext('2d');
    rollScroll = document.getElementById('pitchRollScroll');
    rollKeys = document.getElementById('pitchRollKeys');
    rollContent = document.getElementById('pitchRollContent');
    volumeScroll = document.getElementById('pitchVolumeScroll');
    cursorEl = null;

    rollScroll.addEventListener('scroll', () => {
      rollKeys.scrollTop = rollScroll.scrollTop;
      if (volumeScroll.scrollLeft !== rollScroll.scrollLeft) {
        volumeScroll.scrollLeft = rollScroll.scrollLeft;
      }
    });
    volumeScroll.addEventListener('scroll', () => {
      if (rollScroll.scrollLeft !== volumeScroll.scrollLeft) {
        rollScroll.scrollLeft = volumeScroll.scrollLeft;
      }
    });

    setupSize();
    redraw();
    scrollToRange(INITIAL_FOCUS);
    updateSaveBtnState();

    if (window.QNPitch.recordings) window.QNPitch.recordings.refreshRecList();
  }

  function initBottomBarButtons() {
    const recBtn = document.getElementById('pitchRecBtn');
    if (recBtn && !recBtn.dataset.bound) {
      recBtn.dataset.bound = '1';
      recBtn.addEventListener('click', () => {
        if (recording) endRecording(); else beginRecording();
      });
    }
    const playBtn = document.getElementById('pitchPlayToggleBtn');
    if (playBtn && !playBtn.dataset.bound) {
      playBtn.dataset.bound = '1';
      playBtn.addEventListener('click', () => {
        if (!currentPlayback) return;
        const audio = currentPlayback.audio;
        if (audio.paused) { audio.play(); setPlayIcon(true); tickPlayback(); }
        else { audio.pause(); setPlayIcon(false); }
      });
    }
    const saveBtn = document.getElementById('pitchSaveBtn');
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = '1';
      saveBtn.addEventListener('click', handleSaveClick);
    }
    const clearBtn = document.getElementById('pitchClearBtn');
    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = '1';
      clearBtn.addEventListener('click', async () => {
        const ok = await window.QNPitch.recordings.openClearConfirmDialog();
        if (!ok) return;
        pitchTrack = [];
        pendingRecording = null;
        updateSaveBtnState();
        if (currentPlayback) stopPlayback();
        canvasWidth = PIXELS_PER_SEC * INITIAL_BUFFER_SEC;
        setupSize();
        redraw();
      });
    }
    const pbCloseBtn = document.getElementById('pitchPbCloseBtn');
    if (pbCloseBtn && !pbCloseBtn.dataset.bound) {
      pbCloseBtn.dataset.bound = '1';
      pbCloseBtn.addEventListener('click', stopPlayback);
    }
  }

  function init() {
    initMainArea();
    initBottomBarButtons();
  }
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }

  window.addEventListener('resize', () => {
    if (window.QNPitch.getMode && window.QNPitch.getMode() === 'pitch' && canvas) {
      setupSize();
      redraw();
    }
  });

  window.addEventListener('qnpitch-mode-change', (e) => {
    if (e.detail && e.detail.from === 'pitch') {
      if (recording) endRecording();
    }
  });

  window.QNPitch.pitchMode = {
    redraw,
    startRecording: beginRecording,
    stopRecording: endRecording,
    isRecording: () => recording,
    selectRecording,
    getCurrentPlaybackId: () => currentPlayback ? currentPlayback.id : null,
    initBottomBarButtons
  };
})();
