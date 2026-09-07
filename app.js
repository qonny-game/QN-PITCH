/* ============================================================
   app.js — QNPITCH
   マイク入力のピッチをリアルタイム検出し、ピアノロール状に
   時間軸で描画する「音痴度チェック」ツール。
   録音は音声ファイルとしてIndexedDBに保存し、一覧から選んで
   再生できる（再生中はピッチ軌跡上をカーソルが連動して進む）。
   ============================================================ */

(function () {
  'use strict';

  // ---------- 音階ユーティリティ ----------
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function freqToMidi(freq) {
    return 69 + 12 * Math.log2(freq / 440);
  }
  function midiToNoteName(midi) {
    const rounded = Math.round(midi);
    const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
    const octave = Math.floor(rounded / 12) - 1;
    return name + octave;
  }

  // ---------- 音域 ----------
  // キャンバス・鍵盤ラベルは常にFULL_RANGE（全音域）を保持し、上下スクロールで
  // どこでも自由に確認できる。初期表示はVOCAL帯（A2-A5）の中心へスクロールしておく。
  const FULL_RANGE = { min: 24, max: 108 }; // C1 - C8（一般的な楽器・声域を広くカバー）
  const INITIAL_FOCUS = { min: 45, max: 81 }; // A2 - A5

  // 一度に表示する行数（この行数だけ表示し、残りは縦スクロールで見る）
  const VISIBLE_ROWS = 14;

  // ---------- DOM ----------
  const canvas = document.getElementById('rollCanvas');
  const ctx = canvas.getContext('2d');
  const rollScroll = document.getElementById('rollScroll');
  const rollKeys = document.getElementById('rollKeys');
  const noteReadout = document.getElementById('noteReadout');
  const centsReadout = document.getElementById('centsReadout');
  const statusHint = document.getElementById('statusHint');
  const recBtn = document.getElementById('recBtn');
  const recLabel = document.getElementById('recLabel');
  const clearBtn = document.getElementById('clearBtn');
  const listBtn = document.getElementById('listBtn');
  const recListPanel = document.getElementById('recListPanel');
  const recListScroll = document.getElementById('recListScroll');
  const recListEmpty = document.getElementById('recListEmpty');
  const pbInfoRow = document.getElementById('pbInfoRow');
  const playToggleBtn = document.getElementById('playToggleBtn');
  const playIcon = document.getElementById('playIcon');
  const playLabel = document.getElementById('playLabel');
  const pbName = document.getElementById('pbName');
  const pbProgressFill = document.getElementById('pbProgressFill');
  const pbCloseBtn = document.getElementById('pbCloseBtn');
  const saveBackdrop = document.getElementById('saveBackdrop');
  const savePopup = document.getElementById('savePopup');
  const saveNameInput = document.getElementById('saveNameInput');
  const saveOkBtn = document.getElementById('saveOkBtn');
  const saveCancelBtn = document.getElementById('saveCancelBtn');
  const renameBackdrop = document.getElementById('renameBackdrop');
  const renamePopup = document.getElementById('renamePopup');
  const renameNameInput = document.getElementById('renameNameInput');
  const renameOkBtn = document.getElementById('renameOkBtn');
  const renameCancelBtn = document.getElementById('renameCancelBtn');

  // ---------- キャンバス/鍵盤寸法 ----------
  const PIXELS_PER_SEC = 60;
  let ROW_HEIGHT = 22;
  let canvasHeight = 0;
  let canvasWidth = 0;
  let initialBufferSec = 30;

  function totalRows() {
    return FULL_RANGE.max - FULL_RANGE.min + 1;
  }

  function setupSize() {
    const panelHeight = rollScroll.parentElement.clientHeight || 320;
    ROW_HEIGHT = Math.max(18, Math.floor(panelHeight / VISIBLE_ROWS));
    canvasHeight = totalRows() * ROW_HEIGHT;

    if (canvasWidth < PIXELS_PER_SEC * initialBufferSec) {
      canvasWidth = PIXELS_PER_SEC * initialBufferSec;
    }
    canvas.height = canvasHeight;
    canvas.width = canvasWidth;
    canvas.style.height = canvasHeight + 'px';

    rollScroll.style.height = panelHeight + 'px';
    rollKeys.style.height = panelHeight + 'px';
    rollKeys.innerHTML = '';
    for (let m = FULL_RANGE.min; m <= FULL_RANGE.max; m++) {
      const y = midiToY(m);
      const noteName = NOTE_NAMES[((m % 12) + 12) % 12];
      const isSharp = noteName.includes('#');
      const isC = noteName === 'C';
      const label = document.createElement('div');
      label.className = 'pitch-roll-key-label' + (isSharp ? ' sharp' : '') + (isC ? ' is-c' : '');
      label.style.top = y + 'px';
      label.style.height = ROW_HEIGHT + 'px';
      label.textContent = midiToNoteName(m);
      rollKeys.appendChild(label);
    }
    rollKeys.scrollTop = rollScroll.scrollTop;
  }

  // レンジ選択時：その範囲の中心の音がパネル中央に来るよう縦スクロールを移動
  function scrollToRange(range) {
    const panelHeight = rollScroll.parentElement.clientHeight || 320;
    const centerMidi = (range.min + range.max) / 2;
    const centerY = midiToY(centerMidi);
    const target = centerY - panelHeight / 2 + ROW_HEIGHT / 2;
    const maxScroll = canvasHeight - panelHeight;
    rollScroll.scrollTop = Math.max(0, Math.min(maxScroll, target));
    rollKeys.scrollTop = rollScroll.scrollTop;
  }

  function midiToY(midi) {
    const clamped = Math.max(FULL_RANGE.min, Math.min(FULL_RANGE.max, midi));
    return (FULL_RANGE.max - clamped) * ROW_HEIGHT;
  }

  function drawBackground() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    for (let m = FULL_RANGE.min; m <= FULL_RANGE.max; m++) {
      const y = midiToY(m);
      const noteName = NOTE_NAMES[((m % 12) + 12) % 12];
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

  // ---------- ピッチトラック（録音中/選択中の録音、共通で使う） ----------
  let pitchTrack = []; // { t, midi, cents, voiced }
  let startTime = 0;

  function redraw() {
    drawBackground();
    if (pitchTrack.length < 2) return;

    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < pitchTrack.length; i++) {
      const p = pitchTrack[i];
      if (!p.voiced) { started = false; continue; }
      const x = p.t * PIXELS_PER_SEC;
      const y = midiToY(p.midi) + ROW_HEIGHT / 2;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    for (let i = 0; i < pitchTrack.length; i++) {
      const p = pitchTrack[i];
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
  }

  function ensureWidth(tSeconds) {
    const needed = (tSeconds + 5) * PIXELS_PER_SEC;
    if (needed > canvasWidth) {
      canvasWidth = needed;
      canvas.width = canvasWidth;
      redraw();
    }
  }

  // ---------- 縦スクロール同期（キャンバス⇄鍵盤ラベル列） ----------
  rollScroll.addEventListener('scroll', () => {
    rollKeys.scrollTop = rollScroll.scrollTop;
  });

  // ---------- 再生カーソル ----------
  let cursorEl = null;
  function ensureCursorEl() {
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.className = 'playback-cursor';
      rollScroll.style.position = 'relative';
      rollScroll.appendChild(cursorEl);
    }
    return cursorEl;
  }
  function drawCursor() {
    const el = ensureCursorEl();
    if (currentPlayback && !currentPlayback.audio.paused) {
      const x = currentPlayback.audio.currentTime * PIXELS_PER_SEC;
      el.style.left = x + 'px';
      el.classList.add('active');
    }
  }
  function hideCursor() {
    if (cursorEl) cursorEl.classList.remove('active');
  }

  // ---------- ピッチ検出（自己相関法） ----------
  let audioCtx = null;
  let analyser = null;
  let mediaStream = null;
  let sourceNode = null;
  let rafId = null;
  let recording = false;

  let mediaRecorder = null;
  let recordedChunks = [];

  function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;

    let r1 = 0, r2 = SIZE - 1;
    const thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
      if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < SIZE / 2; i++) {
      if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    }
    const trimmed = buf.slice(r1, r2);
    const newSize = trimmed.length;

    const c = new Array(newSize).fill(0);
    for (let i = 0; i < newSize; i++) {
      for (let j = 0; j < newSize - i; j++) {
        c[i] += trimmed[j] * trimmed[j + i];
      }
    }

    let d = 0;
    while (d < newSize - 1 && c[d] > c[d + 1]) d++;

    let maxVal = -1, maxPos = -1;
    for (let i = d; i < newSize; i++) {
      if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
    }
    let T0 = maxPos;
    if (T0 <= 0) return -1;

    const x1 = c[T0 - 1] || c[T0];
    const x2 = c[T0];
    const x3 = c[T0 + 1] || c[T0];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    const freq = sampleRate / T0;
    if (freq < 50 || freq > 1200) return -1;
    return freq;
  }

  async function startMic() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    sourceNode.connect(analyser);
  }

  function stopMic() {
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
  }

  function analyzeLoop() {
    if (!recording || !analyser) return;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    const freq = autoCorrelate(buf, audioCtx.sampleRate);
    const t = (performance.now() - startTime) / 1000;

    if (freq > 0) {
      const midi = freqToMidi(freq);
      const roundedMidi = Math.round(midi);
      const cents = Math.round((midi - roundedMidi) * 100);
      const noteName = midiToNoteName(midi);

      noteReadout.textContent = noteName;
      const absCents = Math.abs(cents);
      let cls = 'good';
      if (absCents > 30) cls = 'bad';
      else if (absCents > 12) cls = 'warn';
      centsReadout.className = 'cents-readout ' + cls;
      centsReadout.textContent = (cents > 0 ? '+' : '') + cents + ' ¢';

      pitchTrack.push({ t, midi, cents, voiced: true });
    } else {
      noteReadout.textContent = '--';
      centsReadout.className = 'cents-readout';
      centsReadout.textContent = '-- ¢';
      pitchTrack.push({ t, midi: 0, cents: 0, voiced: false });
    }

    ensureWidth(t);
    redraw();
    rollScroll.scrollLeft = t * PIXELS_PER_SEC - rollScroll.clientWidth + 120;

    rafId = requestAnimationFrame(analyzeLoop);
  }

  async function beginRecording() {
    if (!audioCtx) await startMic();
    recording = true;
    pitchTrack = [];
    canvasWidth = PIXELS_PER_SEC * initialBufferSec;
    setupSize();
    startTime = performance.now();

    recordedChunks = [];
    const mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm')) ? 'audio/webm' : '';
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start();

    recBtn.classList.add('recording');
    recLabel.textContent = 'STOP';
    statusHint.textContent = '録音中...';
    statusHint.classList.add('live');
    analyzeLoop();
  }

  async function endRecording() {
    recording = false;
    cancelAnimationFrame(rafId);
    recBtn.classList.remove('recording');
    recLabel.textContent = 'REC';
    statusHint.textContent = 'ファイル名を確認してください';
    statusHint.classList.remove('live');

    const finalTrack = pitchTrack.slice();

    await new Promise((resolve) => {
      mediaRecorder.onstop = resolve;
      mediaRecorder.stop();
    });

    const blob = new Blob(recordedChunks, { type: (recordedChunks[0] && recordedChunks[0].type) || 'audio/webm' });
    const duration = finalTrack.length ? finalTrack[finalTrack.length - 1].t : 0;
    const defaultName = makeRecordingName();

    const chosenName = await openSaveDialog(defaultName);

    if (chosenName === null) {
      // キャンセル：保存せず破棄
      statusHint.textContent = '録音を破棄しました';
      return;
    }

    try {
      await dbAddRecording({ name: chosenName, blob, pitchTrack: finalTrack, duration, createdAt: Date.now() });
      statusHint.textContent = '「' + chosenName + '」を保存しました';
      await refreshRecList();
    } catch (err) {
      console.error(err);
      statusHint.textContent = '保存に失敗しました';
    }
  }

  // ---------- 保存ダイアログ（Promiseで待ち受け。OK→名前、キャンセル→null） ----------
  function openSaveDialog(defaultName) {
    return new Promise((resolve) => {
      saveNameInput.value = defaultName;
      saveBackdrop.classList.add('open');
      savePopup.classList.add('open');
      saveNameInput.focus();

      function cleanup() {
        saveBackdrop.classList.remove('open');
        savePopup.classList.remove('open');
        saveOkBtn.removeEventListener('click', onOk);
        saveCancelBtn.removeEventListener('click', onCancel);
        saveBackdrop.removeEventListener('click', onCancel);
      }
      function onOk() {
        const val = saveNameInput.value.trim() || defaultName;
        cleanup();
        resolve(val);
      }
      function onCancel() {
        cleanup();
        resolve(null);
      }
      saveOkBtn.addEventListener('click', onOk);
      saveCancelBtn.addEventListener('click', onCancel);
      saveBackdrop.addEventListener('click', onCancel);
    });
  }

  // ---------- リネームダイアログ ----------
  function openRenameDialog(currentName) {
    return new Promise((resolve) => {
      renameNameInput.value = currentName;
      renameBackdrop.classList.add('open');
      renamePopup.classList.add('open');
      renameNameInput.focus();

      function cleanup() {
        renameBackdrop.classList.remove('open');
        renamePopup.classList.remove('open');
        renameOkBtn.removeEventListener('click', onOk);
        renameCancelBtn.removeEventListener('click', onCancel);
        renameBackdrop.removeEventListener('click', onCancel);
      }
      function onOk() {
        const val = renameNameInput.value.trim();
        cleanup();
        resolve(val || null);
      }
      function onCancel() {
        cleanup();
        resolve(null);
      }
      renameOkBtn.addEventListener('click', onOk);
      renameCancelBtn.addEventListener('click', onCancel);
      renameBackdrop.addEventListener('click', onCancel);
    });
  }

  recBtn.addEventListener('click', async () => {
    if (!recording) {
      try {
        stopPlayback();
        await beginRecording();
      } catch (err) {
        statusHint.textContent = 'マイクアクセスが拒否されました';
        console.error(err);
      }
    } else {
      endRecording();
    }
  });

  clearBtn.addEventListener('click', () => {
    pitchTrack = [];
    canvasWidth = PIXELS_PER_SEC * initialBufferSec;
    setupSize();
    redraw();
    noteReadout.textContent = '--';
    centsReadout.className = 'cents-readout';
    centsReadout.textContent = '-- ¢';
    rollScroll.scrollLeft = 0;
  });

  // ============================================================
  // IndexedDB — 録音の永続保存
  // ============================================================
  const DB_NAME = 'qnpitch-db';
  const DB_VERSION = 1;
  const STORE_NAME = 'recordings';
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  async function dbAddRecording(record) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(record);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function dbGetAllRecordings() {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = function () { resolve(req.result.sort(function (a, b) { return b.createdAt - a.createdAt; })); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function dbDeleteRecording(id) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function dbRenameRecording(id, newName) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = function () {
        const rec = getReq.result;
        if (!rec) { resolve(); return; }
        rec.name = newName;
        const putReq = store.put(rec);
        putReq.onsuccess = function () { resolve(); };
        putReq.onerror = function () { reject(putReq.error); };
      };
      getReq.onerror = function () { reject(getReq.error); };
    });
  }

  function makeRecordingName() {
    const d = new Date();
    function pad(n) { return String(n).padStart(2, '0'); }
    return 'REC ' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function formatDateTime(ts) {
    const d = new Date(ts);
    function pad(n) { return String(n).padStart(2, '0'); }
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function formatDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  // ============================================================
  // 録音一覧パネル
  // ============================================================
  let recordingsCache = [];

  async function refreshRecList() {
    recordingsCache = await dbGetAllRecordings();
    recListScroll.innerHTML = '';
    if (!recordingsCache.length) {
      recListScroll.appendChild(recListEmpty);
      return;
    }
    recordingsCache.forEach(function (rec) {
      const row = document.createElement('div');
      row.className = 'rec-row';
      if (currentPlayback && currentPlayback.id === rec.id) row.classList.add('playing');

      const icon = document.createElement('div');
      icon.className = 'rec-row-icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

      const info = document.createElement('div');
      info.className = 'rec-row-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'rec-row-name';
      nameEl.textContent = rec.name;
      const metaEl = document.createElement('div');
      metaEl.className = 'rec-row-meta';
      metaEl.textContent = formatDateTime(rec.createdAt) + ' ・ ' + formatDuration(rec.duration);
      info.appendChild(nameEl);
      info.appendChild(metaEl);

      const editBtn = document.createElement('button');
      editBtn.className = 'rec-row-edit';
      editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
      editBtn.addEventListener('click', async function (e) {
        e.stopPropagation();
        const newName = await openRenameDialog(rec.name);
        if (newName && newName !== rec.name) {
          await dbRenameRecording(rec.id, newName);
          if (currentPlayback && currentPlayback.id === rec.id) pbName.textContent = newName;
          await refreshRecList();
        }
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'rec-row-delete';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (currentPlayback && currentPlayback.id === rec.id) stopPlayback();
        await dbDeleteRecording(rec.id);
        await refreshRecList();
      });

      row.appendChild(icon);
      row.appendChild(info);
      row.appendChild(editBtn);
      row.appendChild(delBtn);
      row.addEventListener('click', function () { selectRecording(rec); });
      recListScroll.appendChild(row);
    });
  }

  listBtn.addEventListener('click', function () {
    const willOpen = !recListPanel.classList.contains('open');
    recListPanel.classList.toggle('open', willOpen);
    listBtn.classList.toggle('active', willOpen);
    if (willOpen) refreshRecList();
  });

  // ============================================================
  // 再生
  // ============================================================
  let currentPlayback = null; // { id, audio, rafId }

  function setPlayIcon(playing) {
    playIcon.innerHTML = playing
      ? '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
    playLabel.textContent = playing ? 'PAUSE' : 'PLAY';
    playToggleBtn.classList.toggle('playing', playing);
  }

  function stopPlayback() {
    if (currentPlayback) {
      currentPlayback.audio.pause();
      cancelAnimationFrame(currentPlayback.rafId);
      URL.revokeObjectURL(currentPlayback.audio.src);
      currentPlayback = null;
    }
    pbInfoRow.classList.remove('open');
    playToggleBtn.disabled = true;
    setPlayIcon(false);
    hideCursor();
    refreshRecList();
  }

  function selectRecording(rec) {
    if (recording) return;
    stopPlayback();

    const url = URL.createObjectURL(rec.blob);
    const audio = new Audio(url);
    currentPlayback = { id: rec.id, audio: audio, rafId: null };

    pitchTrack = rec.pitchTrack;
    canvasWidth = Math.max(PIXELS_PER_SEC * initialBufferSec, (rec.duration + 5) * PIXELS_PER_SEC);
    setupSize();
    redraw();

    pbName.textContent = rec.name;
    pbProgressFill.style.width = '0%';
    pbInfoRow.classList.add('open');
    playToggleBtn.disabled = false;

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
      pbProgressFill.style.width = pct + '%';
      const x = audio.currentTime * PIXELS_PER_SEC;
      rollScroll.scrollLeft = Math.max(0, x - rollScroll.clientWidth / 2);
      drawCursor();
    }
    currentPlayback.rafId = requestAnimationFrame(tickPlayback);
  }

  playToggleBtn.addEventListener('click', function () {
    if (!currentPlayback) return;
    const audio = currentPlayback.audio;
    if (audio.paused) {
      audio.play();
      setPlayIcon(true);
      tickPlayback();
    } else {
      audio.pause();
      setPlayIcon(false);
    }
  });

  pbCloseBtn.addEventListener('click', stopPlayback);

  // ---------- 初期化 ----------
  window.addEventListener('resize', function () {
    setupSize();
    redraw();
  });

  setupSize();
  redraw();
  scrollToRange(INITIAL_FOCUS);
  refreshRecList();
})();
