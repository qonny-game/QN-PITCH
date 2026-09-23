// ============================================================
// pitch-mode-pitch.js
// PITCHMODE：ピッチロール表示・録音・スコア判定。
//
// 【移植元】旧QNPITCH(app.js)のロール描画・マイク解析・REC/PLAY/SAVE・
// 録音一覧を移植。ピッチ検出はpitch-core.js、フィルタ/スコア判定は
// pitch-filters.js、永続化はpitch-recordings.jsに分離済みのため、
// ここではそれらを組み合わせてUIを構築する。
//
// 【今回のスコープ外（次回以降に実装）】KEY&DRONE（スケールハイライト・
// 基準ピッチ再生）、内蔵メトロノーム、ピンチズーム（VISIBLE_ROWS可変）、
// ノートラベルのタップ発音。md/AI_ASSISTANT_PROJECT_CONTEXT.md参照。
// ============================================================

window.QNPitch = window.QNPitch || {};

(function () {
  const core = window.QNPitch.core;

  // ==================== 表示設定（固定値。ピンチズームは次回実装） ====================
  const FULL_RANGE = { min: 24, max: 108 }; // C1 - C8
  const VISIBLE_ROWS = 22; // 固定値（旧QNPITCHのVISIBLE_ROWS_MAXとMINの中間程度）
  const PIXELS_PER_SEC = 60;
  const INITIAL_BUFFER_SEC = 30;
  const INITIAL_FOCUS = { min: 48, max: 72 }; // 初期スクロール位置（C3-C5あたり）

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
  let pitchTrack = []; // { t, midi, cents, rms, voiced }
  let startTime = 0;
  let recording = false;
  let pendingRecording = null; // { blob, pitchTrack, duration, score, name }
  let currentPlayback = null; // { id, audio, rafId }

  let micSession = null;
  let mediaRecorder = null;
  let recordedChunks = [];

  // Canvas参照（renderMainViewのたびに再取得）
  let canvas = null, ctx = null;
  let volumeCanvas = null, volCtx = null;
  let rollScroll = null, rollKeys = null, rollContent = null;
  let volumeScroll = null;
  let cursorEl = null;

  // ==================== キャンバスサイズ ====================
  function setupSize() {
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

    rollScroll.style.height = panelHeight + 'px';
    rollKeys.style.height = panelHeight + 'px';
    rollKeys.innerHTML = '';
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

    // 解析用セッションは録音用ストリームとは別に、pitch-core.jsの
    // 通常経路（マイクを再取得）で開始する。ブラウザによっては同一
    // ストリームをMediaRecorderとAnalyserNodeの両方に使い回すと
    // 不安定になることがあるため、旧QNPITCHと同様に独立させている。
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

    const recBtn = document.getElementById('pitchRecBtn');
    const recLabel = document.getElementById('pitchRecLabel');
    if (recBtn) recBtn.classList.add('recording');
    if (recLabel) recLabel.textContent = 'STOP';
    updateStatusHint('録音中...', true);
  }

  function handleAnalysisFrame(freq, rms) {
    if (!recording) return;
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

    const recBtn = document.getElementById('pitchRecBtn');
    const recLabel = document.getElementById('pitchRecLabel');
    if (recBtn) recBtn.classList.remove('recording');
    if (recLabel) recLabel.textContent = 'REC';
    updateStatusHint('マイク未接続 — RECを押して開始', false);

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
      refreshRecList();
    } catch (err) {
      console.error(err);
      updateStatusHint('保存に失敗しました', false);
    }
  }

  // ==================== 再生 ====================
  function setPlayIcon(isPlaying) {
    const playIcon = document.getElementById('pitchPlayIcon');
    const playLabel = document.getElementById('pitchPlayLabel');
    if (playIcon) playIcon.innerHTML = isPlaying
      ? '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
    if (playLabel) playLabel.textContent = isPlaying ? 'PAUSE' : 'PLAY';
  }

  function stopPlayback() {
    if (currentPlayback) {
      currentPlayback.audio.pause();
      cancelAnimationFrame(currentPlayback.rafId);
      URL.revokeObjectURL(currentPlayback.audio.src);
      currentPlayback = null;
    }
    const pbInfoRow = document.getElementById('pitchPbInfoRow');
    const playToggleBtn = document.getElementById('pitchPlayToggleBtn');
    if (pbInfoRow) pbInfoRow.classList.remove('open');
    if (playToggleBtn) playToggleBtn.disabled = true;
    setPlayIcon(false);
    hideCursor();
    refreshRecList();
    setupSize();
    redraw();
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
    if (pbInfoRow) pbInfoRow.classList.add('open');
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
    refreshRecList();
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

  // ==================== 録音一覧パネル ====================
  async function refreshRecList() {
    const scrollEl = document.getElementById('pitchRecListScroll');
    if (!scrollEl) return;
    const rec = window.QNPitch.recordings;
    const list = await rec.dbGetAllRecordings();
    scrollEl.innerHTML = '';
    if (!list.length) {
      scrollEl.innerHTML = '<p class="pitch-rec-list-empty">まだ録音がありません</p>';
      return;
    }
    list.forEach(function (item) {
      const row = document.createElement('div');
      row.className = 'pitch-rec-row';
      if (currentPlayback && currentPlayback.id === item.id) row.classList.add('playing');

      let metaText = rec.formatDateTime(item.createdAt) + ' ・ ' + rec.formatDuration(item.duration);
      if (item.score !== null && item.score !== undefined) metaText += ' ・ ' + item.score + '%';

      row.innerHTML =
        '<div class="pitch-rec-row-icon"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>' +
        '<div class="pitch-rec-row-info">' +
          '<div class="pitch-rec-row-name"></div>' +
          '<div class="pitch-rec-row-meta"></div>' +
        '</div>' +
        '<button type="button" class="pitch-rec-row-edit"><svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>' +
        '<button type="button" class="pitch-rec-row-delete">✕</button>';

      row.querySelector('.pitch-rec-row-name').textContent = item.name;
      row.querySelector('.pitch-rec-row-meta').textContent = metaText;

      row.querySelector('.pitch-rec-row-edit').addEventListener('click', async (e) => {
        e.stopPropagation();
        const newName = await rec.openRenameDialog(item.name);
        if (newName && newName !== item.name) {
          await rec.dbRenameRecording(item.id, newName);
          if (currentPlayback && currentPlayback.id === item.id) {
            const pbName = document.getElementById('pitchPbName');
            if (pbName) pbName.textContent = newName;
          }
          await refreshRecList();
        }
      });
      row.querySelector('.pitch-rec-row-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (currentPlayback && currentPlayback.id === item.id) stopPlayback();
        await rec.dbDeleteRecording(item.id);
        await refreshRecList();
      });
      row.addEventListener('click', () => selectRecording(item));

      scrollEl.appendChild(row);
    });
  }

  // ==================== メインウインドウ ====================
  function renderMainView(container) {
    container.innerHTML =
      '<div id="pitchStage">' +
        '<div class="pitch-stage-meta">' +
          '<span class="pitch-stage-meta-label">NOTE</span>' +
          '<span class="pitch-stage-meta-value" id="pitchNoteReadout">--</span>' +
          '<span class="pitch-cents-readout" id="pitchCentsReadout">-- ¢</span>' +
        '</div>' +
        '<div class="pitch-roll-panel">' +
          '<div class="pitch-roll-keys" id="pitchRollKeys"></div>' +
          '<div class="pitch-roll-scroll" id="pitchRollScroll">' +
            '<div class="pitch-roll-content" id="pitchRollContent">' +
              '<canvas id="pitchRollCanvas"></canvas>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="pitch-volume-panel">' +
          '<div class="pitch-volume-panel-label"><span>VOL</span></div>' +
          '<div class="pitch-volume-scroll" id="pitchVolumeScroll">' +
            '<canvas id="pitchVolumeCanvas"></canvas>' +
          '</div>' +
        '</div>' +
        '<p class="pitch-stage-hint" id="pitchStatusHint">マイク未接続 — RECを押して開始</p>' +
      '</div>';

    canvas = document.getElementById('pitchRollCanvas');
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

    window.QNPitch.recordings.ensureDialogsInDom();

    setupSize();
    redraw();
    scrollToRange(INITIAL_FOCUS);
    refreshRecList();
    updateSaveBtnState();
  }

  function onModeLeave() {
    if (recording) endRecording();
    if (currentPlayback) stopPlayback();
  }

  // ==================== 下部バー ====================
  function renderBottomBar(container) {
    container.innerHTML =
      '<div class="pitch-pb-info-row" id="pitchPbInfoRow">' +
        '<span class="pitch-pb-name" id="pitchPbName">—</span>' +
        '<span class="pitch-pb-score" id="pitchPbScore"></span>' +
        '<div class="pitch-pb-progress-track"><div class="pitch-pb-progress-fill" id="pitchPbProgressFill"></div></div>' +
        '<button type="button" class="pitch-pb-close-btn" id="pitchPbCloseBtn" title="Close">' +
          '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 7 19l5.59-5.59L17.59 19 19 17.59 13.41 12z"/></svg>' +
        '</button>' +
      '</div>' +
      '<button type="button" class="pcv2-ctrl-btn" id="pitchRecBtn" title="Record / Stop">' +
        '<svg id="pitchRecIcon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>' +
        '<span id="pitchRecLabel">REC</span>' +
      '</button>' +
      '<button type="button" class="pcv2-ctrl-btn" id="pitchPlayToggleBtn" title="Play / Pause" disabled>' +
        '<svg id="pitchPlayIcon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' +
        '<span id="pitchPlayLabel">PLAY</span>' +
      '</button>' +
      '<button type="button" class="pcv2-ctrl-btn" id="pitchSaveBtn" title="Save recording" disabled>' +
        '<svg viewBox="0 0 24 24"><path d="M17 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>' +
        '<span>SAVE</span>' +
      '</button>' +
      '<button type="button" class="pcv2-ctrl-btn" id="pitchClearBtn" title="Clear roll">' +
        '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>' +
        '<span>CLEAR</span>' +
      '</button>';

    document.getElementById('pitchRecBtn').addEventListener('click', () => {
      if (recording) endRecording(); else beginRecording();
    });
    document.getElementById('pitchPlayToggleBtn').addEventListener('click', () => {
      if (!currentPlayback) return;
      const audio = currentPlayback.audio;
      if (audio.paused) { audio.play(); setPlayIcon(true); tickPlayback(); }
      else { audio.pause(); setPlayIcon(false); }
    });
    document.getElementById('pitchSaveBtn').addEventListener('click', handleSaveClick);
    document.getElementById('pitchPbCloseBtn').addEventListener('click', stopPlayback);
    document.getElementById('pitchClearBtn').addEventListener('click', async () => {
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

  window.QNPitch.mainView.register('pitch', {
    render: renderMainView,
    onModeLeave
  });

  window.QNPitch.bottomBar.register('pitch', {
    render: renderBottomBar
  });

  // 録音一覧パネル（アイコンバー→パネル）
  window.QNPitch.panels.register('pitch-recordings-list', {
    label: 'Recordings',
    icon: '<path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2z"/>',
    modes: ['pitch'],
    render(panelBody) {
      panelBody.innerHTML = '<div class="pitch-rec-list-scroll" id="pitchRecListScroll"></div>';
      refreshRecList();
    }
  });

  window.addEventListener('resize', () => {
    if (window.QNPitch.getMode && window.QNPitch.getMode() === 'pitch' && canvas) {
      setupSize();
      redraw();
    }
  });

  window.QNPitch.pitchMode = {
    redraw
  };
})();
