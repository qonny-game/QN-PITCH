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

  // 一度に表示する行数（この行数だけ表示し、残りは縦スクロールで見る）。
  // ピンチジェスチャーで可変にする：ピンチイン（指を狭める）で行数を増やし
  // 広い音域を一望、ピンチアウト（指を広げる）で行数を減らし拡大表示にする。
  // 初期表示はVISIBLE_ROWS_MAX（最大ズームアウト＝全音域が一望できる状態）から始める。
  const VISIBLE_ROWS_MIN = 6;   // 拡大の上限（見やすさ優先）
  const VISIBLE_ROWS_MAX = 40;  // 縮小の上限（一望性優先）
  let VISIBLE_ROWS = VISIBLE_ROWS_MAX;

  // ---------- ノイズ除去フィルタ設定 ----------
  const FILTER_DEFAULTS = {
    jumpWindowMs: 150,     // 時間窓：この時間内での変化を見る
    jumpSemitones: 2,      // 音程変化量：時間窓内でこの半音数以上動いたら急変とみなす
    spikeRemoval: true,    // スパイク除去（孤立した単発の飛び値を除去）
    rmsThreshold: 0,       // 音量ゲート：0〜0.5のRMS実スケール（0.01刻み、0=無効）
    pitchDriftEnabled: false,   // 音程ズレハイライトのON/OFF
    pitchDriftDurationMs: 400,  // 同じ音を維持しているとみなす最低期間(ms)
    pitchDriftCents: 20,        // その区間の平均セントズレがこれを超えたら赤くする
    vibratoEnabled: true,       // ビブラート検出のON/OFF（誤検出防止＋専用色表示）
    vibratoMinRateHz: 3,        // ビブラートとみなす最低の揺れ周期（Hz）
    vibratoMaxRateHz: 8,        // ビブラートとみなす最高の揺れ周期（Hz）
    vibratoMinCents: 15,        // ビブラートとみなす最低の揺れ幅（セント、片振幅目安）
    scoreCentsThreshold: 25,    // スコア計算用：維持区間の平均ズレがこれ以内なら「適正」とみなす
  };
  const FILTER_STORAGE_KEY = 'qnpitch-filter-settings';
  let filterSettings = loadFilterSettings();

  function loadFilterSettings() {
    try {
      const raw = localStorage.getItem(FILTER_STORAGE_KEY);
      if (!raw) return Object.assign({}, FILTER_DEFAULTS);
      const parsed = JSON.parse(raw);
      const merged = Object.assign({}, FILTER_DEFAULTS, parsed);
      // 旧バージョン（0〜100 / 0〜10スケール）で保存された値が残っている場合に備えてクランプする
      merged.rmsThreshold = Math.max(0, Math.min(0.5, merged.rmsThreshold));
      return merged;
    } catch (e) {
      return Object.assign({}, FILTER_DEFAULTS);
    }
  }
  function saveFilterSettings() {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filterSettings));
    } catch (e) { /* localStorage不可でも致命的ではないので無視 */ }
  }

  // ---------- キー・スケール表示／基準ピッチ(ドローン)設定 ----------
  const KEY_DEFAULTS = {
    keyHighlightEnabled: false, // スケール構成音の背景ハイライトON/OFF
    keyRoot: 0,                 // ルート音のPC(0=C, 1=C#, ... 11=B)
    keyMode: 'major',           // 'major' or 'minor'
    droneOctave: 3,             // ドローン再生時のオクターブ（3ならC3等、MIDIオクターブ表記）
  };
  const KEY_STORAGE_KEY = 'qnpitch-key-settings';
  let keySettings = loadKeySettings();
  let droneEnabled = false; // ドローンのON/OFFは再生状態なので保存はせず毎回OFFから始める

  function loadKeySettings() {
    try {
      const raw = localStorage.getItem(KEY_STORAGE_KEY);
      if (!raw) return Object.assign({}, KEY_DEFAULTS);
      const parsed = JSON.parse(raw);
      return Object.assign({}, KEY_DEFAULTS, parsed);
    } catch (e) {
      return Object.assign({}, KEY_DEFAULTS);
    }
  }
  function saveKeySettings() {
    try {
      localStorage.setItem(KEY_STORAGE_KEY, JSON.stringify(keySettings));
    } catch (e) { /* 無視 */ }
  }

  // メジャー/マイナースケールの、ルートからの半音間隔（0始まり）
  const SCALE_INTERVALS = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
  };
  function isInScale(midi) {
    const pc = ((midi % 12) + 12) % 12;
    const rel = ((pc - keySettings.keyRoot) % 12 + 12) % 12;
    return SCALE_INTERVALS[keySettings.keyMode].indexOf(rel) !== -1;
  }

  // ---------- 簡易メトロノーム設定 ----------
  const TEMPO_DEFAULTS = {
    bpm: 120,          // テンポ(拍/分)
    beatsPerBar: 4,     // 拍子の分子（1小節あたりの拍数）
    volume: 0.6,        // クリック音量(0-1)
  };
  const TEMPO_STORAGE_KEY = 'qnpitch-tempo-settings';
  let tempoSettings = loadTempoSettings();
  let metronomeEnabled = false; // ON/OFFは再生状態なので保存はせず毎回OFFから始める

  function loadTempoSettings() {
    try {
      const raw = localStorage.getItem(TEMPO_STORAGE_KEY);
      if (!raw) return Object.assign({}, TEMPO_DEFAULTS);
      const parsed = JSON.parse(raw);
      return Object.assign({}, TEMPO_DEFAULTS, parsed);
    } catch (e) {
      return Object.assign({}, TEMPO_DEFAULTS);
    }
  }
  function saveTempoSettings() {
    try {
      localStorage.setItem(TEMPO_STORAGE_KEY, JSON.stringify(tempoSettings));
    } catch (e) { /* 無視 */ }
  }

  // ---------- DOM ----------
  const canvas = document.getElementById('rollCanvas');
  const ctx = canvas.getContext('2d');
  const rollScroll = document.getElementById('rollScroll');
  const topControls = document.getElementById('topControls');
  const topControlsSpacer = document.getElementById('topControlsSpacer');
  const rollKeys = document.getElementById('rollKeys');
  const noteReadout = document.getElementById('noteReadout');
  const centsReadout = document.getElementById('centsReadout');
  const statusHint = document.getElementById('statusHint');
  const recBtn = document.getElementById('recBtn');
  const recLabel = document.getElementById('recLabel');
  const clearBtn = document.getElementById('clearBtn');
  const clearConfirmBackdrop = document.getElementById('clearConfirmBackdrop');
  const clearConfirmPopup = document.getElementById('clearConfirmPopup');
  const clearConfirmOkBtn = document.getElementById('clearConfirmOkBtn');
  const clearConfirmCancelBtn = document.getElementById('clearConfirmCancelBtn');
  const saveBtn = document.getElementById('saveBtn');
  const listBtn = document.getElementById('listBtn');
  const recListBackdrop = document.getElementById('recListBackdrop');
  const recListPopup = document.getElementById('recListPopup');
  const recListCloseBtn = document.getElementById('recListCloseBtn');
  const recListScroll = document.getElementById('recListScroll');
  const recListEmpty = document.getElementById('recListEmpty');
  const pbInfoRow = document.getElementById('pbInfoRow');
  const playToggleBtn = document.getElementById('playToggleBtn');
  const playIcon = document.getElementById('playIcon');
  const playLabel = document.getElementById('playLabel');
  const pbName = document.getElementById('pbName');
  const pbScore = document.getElementById('pbScore');
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
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsBackdrop = document.getElementById('settingsBackdrop');
  const settingsPopup = document.getElementById('settingsPopup');
  const settingsCloseBtn = document.getElementById('settingsCloseBtn');
  const settingsResetBtn = document.getElementById('settingsResetBtn');
  const settingsCancelBtn = document.getElementById('settingsCancelBtn');
  const jumpWindowInput = document.getElementById('jumpWindowInput');
  const jumpWindowValue = document.getElementById('jumpWindowValue');
  const jumpSemitonesInput = document.getElementById('jumpSemitonesInput');
  const jumpSemitonesValue = document.getElementById('jumpSemitonesValue');
  const spikeToggle = document.getElementById('spikeToggle');
  const rmsThresholdInput = document.getElementById('rmsThresholdInput');
  const rmsThresholdValue = document.getElementById('rmsThresholdValue');
  const pitchDriftToggle = document.getElementById('pitchDriftToggle');
  const pitchDriftDurationInput = document.getElementById('pitchDriftDurationInput');
  const pitchDriftDurationValue = document.getElementById('pitchDriftDurationValue');
  const pitchDriftCentsInput = document.getElementById('pitchDriftCentsInput');
  const pitchDriftCentsValue = document.getElementById('pitchDriftCentsValue');
  const vibratoToggle = document.getElementById('vibratoToggle');
  const vibratoMinRateInput = document.getElementById('vibratoMinRateInput');
  const vibratoMinRateValue = document.getElementById('vibratoMinRateValue');
  const vibratoMaxRateInput = document.getElementById('vibratoMaxRateInput');
  const vibratoMaxRateValue = document.getElementById('vibratoMaxRateValue');
  const vibratoMinCentsInput = document.getElementById('vibratoMinCentsInput');
  const vibratoMinCentsValue = document.getElementById('vibratoMinCentsValue');
  const scoreCentsInput = document.getElementById('scoreCentsInput');
  const scoreCentsValue = document.getElementById('scoreCentsValue');
  const keyBtn = document.getElementById('openKeyFromSettingsBtn');
  const keyBackdrop = document.getElementById('keyBackdrop');
  const keyPopup = document.getElementById('keyPopup');
  const keyCloseBtn = document.getElementById('keyCloseBtn');
  const keyHighlightToggle = document.getElementById('keyHighlightToggle');
  const keyRootSelect = document.getElementById('keyRootSelect');
  const keyModeSelect = document.getElementById('keyModeSelect');
  const droneToggle = document.getElementById('droneToggle');
  const droneOctaveInput = document.getElementById('droneOctaveInput');
  const droneOctaveValue = document.getElementById('droneOctaveValue');
  const tempoBtn = document.getElementById('tempoBtn');
  const tempoBackdrop = document.getElementById('tempoBackdrop');
  const tempoPopup = document.getElementById('tempoPopup');
  const tempoCloseBtn = document.getElementById('tempoCloseBtn');
  const metronomeToggle = document.getElementById('metronomeToggle');
  const tempoBeatsSelect = document.getElementById('tempoBeatsSelect');
  const tempoBpmInput = document.getElementById('tempoBpmInput');
  const tempoBpmValue = document.getElementById('tempoBpmValue');
  const tempoVolumeInput = document.getElementById('tempoVolumeInput');
  const tempoVolumeValue = document.getElementById('tempoVolumeValue');
  const volumeScroll = document.getElementById('volumeScroll');
  const volumeCanvas = document.getElementById('volumeCanvas');
  const volCtx = volumeCanvas.getContext('2d');

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
    // 下部固定のコントロールバー(top-controls)は position:fixed のため通常フローの
    // 高さに寄与しない。spacer要素にその実高さを反映させることで、ピッチロール/
    // 音量パネルがコントロールバーの下に隠れないようにする。
    if (topControls && topControlsSpacer) {
      topControlsSpacer.style.height = topControls.offsetHeight + 'px';
    }

    const panelHeight = rollScroll.parentElement.clientHeight || 320;
    ROW_HEIGHT = Math.max(18, Math.floor(panelHeight / VISIBLE_ROWS));
    canvasHeight = totalRows() * ROW_HEIGHT;

    if (canvasWidth < PIXELS_PER_SEC * initialBufferSec) {
      canvasWidth = PIXELS_PER_SEC * initialBufferSec;
    }
    canvas.height = canvasHeight;
    canvas.width = canvasWidth;
    canvas.style.height = canvasHeight + 'px';

    syncVolumeCanvasWidth();

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
      label.dataset.midi = String(m);
      attachKeyPressHandlers(label, m);
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

  // ---------- ピンチジェスチャーで表示音域の密度（VISIBLE_ROWS）を変える ----------
  // ピンチイン（指の間隔が狭まる）→ VISIBLE_ROWSを増やす → 1行が小さくなり、
  //   より広い音域を一望できる。
  // ピンチアウト（指の間隔が広がる）→ VISIBLE_ROWSを減らす → 1行が大きくなり、
  //   拡大表示になる。
  // ピンチ中心の音高がその後も画面の同じ位置に留まるよう、スクロール位置を
  // 併せて補正する。
  let pinchStartDist = null;
  let pinchStartRows = VISIBLE_ROWS;
  let pinchAnchorMidi = null; // ピンチ中心が指していた音高（MIDIノート番号、小数可）
  let pinchAnchorOffsetY = null; // パネル上端からピンチ中心までの距離(px)

  function touchDist(t0, t1) {
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function yToMidi(y) {
    // canvas上のy座標（0=FULL_RANGE.max側の上端）からMIDIノート番号を逆算
    return FULL_RANGE.max - y / ROW_HEIGHT;
  }

  rollScroll.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
      pinchStartDist = touchDist(e.touches[0], e.touches[1]);
      pinchStartRows = VISIBLE_ROWS;

      const rect = rollScroll.getBoundingClientRect();
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      pinchAnchorOffsetY = midY;
      pinchAnchorMidi = yToMidi(rollScroll.scrollTop + midY);
    }
  }, { passive: true });

  rollScroll.addEventListener('touchmove', function (e) {
    if (e.touches.length === 2 && pinchStartDist) {
      e.preventDefault();
      const dist = touchDist(e.touches[0], e.touches[1]);
      const scale = dist / pinchStartDist; // >1: 指を広げた(ピンチアウト), <1: 狭めた(ピンチイン)

      // scaleが大きいほど拡大したい→VISIBLE_ROWSは減らす（逆比例）
      let newRows = Math.round(pinchStartRows / scale);
      newRows = Math.max(VISIBLE_ROWS_MIN, Math.min(VISIBLE_ROWS_MAX, newRows));
      if (newRows !== VISIBLE_ROWS) {
        VISIBLE_ROWS = newRows;
        setupSize();
        redraw();
      }

      // アンカーの音高が同じ画面位置に留まるようスクロール位置を補正
      if (pinchAnchorMidi !== null) {
        const panelHeight = rollScroll.parentElement.clientHeight || 320;
        const anchorY = midiToY(pinchAnchorMidi);
        const target = anchorY - pinchAnchorOffsetY;
        const maxScroll = Math.max(0, canvasHeight - panelHeight);
        rollScroll.scrollTop = Math.max(0, Math.min(maxScroll, target));
        rollKeys.scrollTop = rollScroll.scrollTop;
      }
    }
  }, { passive: false });

  function endPinch() {
    pinchStartDist = null;
    pinchAnchorMidi = null;
    pinchAnchorOffsetY = null;
  }
  rollScroll.addEventListener('touchend', endPinch, { passive: true });
  rollScroll.addEventListener('touchcancel', endPinch, { passive: true });

  function midiToY(midi) {
    const clamped = Math.max(FULL_RANGE.min, Math.min(FULL_RANGE.max, midi));
    return (FULL_RANGE.max - clamped) * ROW_HEIGHT;
  }

  // ノートラベルを押している間だけ発音し、離したら止める（マウス・タッチ両対応）
  function attachKeyPressHandlers(label, midi) {
    function onDown(e) {
      if (recording) return; // 録音中はマイク音と混ざるため無効
      e.preventDefault();
      label.classList.add('pressed');
      startKeyPressTone(midi);
      if (label.setPointerCapture && e.pointerId !== undefined) {
        try { label.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
      }
    }
    function onUp() {
      label.classList.remove('pressed');
      stopKeyPressTone();
    }
    label.addEventListener('pointerdown', onDown);
    label.addEventListener('pointerup', onUp);
    label.addEventListener('pointerleave', onUp);
    label.addEventListener('pointercancel', onUp);
  }

  // ノートラベルをタップしている間、対応する行番号（MIDI）を保持する
  let activeKeyPressMidi = null;

  function drawBackground() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    for (let m = FULL_RANGE.min; m <= FULL_RANGE.max; m++) {
      const y = midiToY(m);
      const noteName = NOTE_NAMES[((m % 12) + 12) % 12];
      const isSharp = noteName.includes('#');
      const isC = noteName === 'C';

      if (activeKeyPressMidi !== null && m === activeKeyPressMidi) {
        ctx.fillStyle = 'rgba(236, 72, 153, 0.32)';
      } else if (keySettings.keyHighlightEnabled && isInScale(m)) {
        ctx.fillStyle = 'rgba(74, 222, 128, 0.10)';
      } else {
        ctx.fillStyle = isSharp ? '#1a1a22' : '#1e1e28';
      }
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
  let pitchTrack = []; // { t, midi, cents, rms, voiced }
  let startTime = 0;

  // 設定に基づいてpitchTrackをフィルタリングした「描画用」配列を作る。
  // 元のpitchTrack自体は変更しない（設定を変えて再描画すれば結果も変わる）。
  function applyFilters(track) {
    if (!track.length) return track;

    // 1. 音量ゲート：閾値未満のrmsは無効点にする
    const rmsThreshold = filterSettings.rmsThreshold; // RMS実スケールの値をそのまま使用
    let filtered = track.map(function (p) {
      if (p.voiced && rmsThreshold > 0 && (p.rms === undefined || p.rms < rmsThreshold)) {
        return Object.assign({}, p, { voiced: false });
      }
      return p;
    });

    // 2. 急変スキップ：時間窓内で音程変化量が閾値を超える箇所を無効にする
    const windowSec = filterSettings.jumpWindowMs / 1000;
    if (filterSettings.jumpSemitones > 0 && windowSec > 0) {
      filtered = filtered.map(function (p, i) {
        if (!p.voiced) return p;
        // 直近windowSec以内の有声点と比較して、半音差が閾値を超えていたら無効化
        for (let j = i - 1; j >= 0; j--) {
          const prev = filtered[j];
          if (p.t - prev.t > windowSec) break;
          if (!prev.voiced) continue;
          if (Math.abs(p.midi - prev.midi) >= filterSettings.jumpSemitones) {
            return Object.assign({}, p, { voiced: false });
          }
        }
        return p;
      });
    }

    // 3. スパイク除去：前後の有声点とどちらとも大きく外れている孤立点を無効にする
    if (filterSettings.spikeRemoval) {
      filtered = filtered.map(function (p, i) {
        if (!p.voiced) return p;
        let prev = null, next = null;
        for (let j = i - 1; j >= 0; j--) { if (filtered[j].voiced) { prev = filtered[j]; break; } }
        for (let j = i + 1; j < filtered.length; j++) { if (filtered[j].voiced) { next = filtered[j]; break; } }
        if (prev && next) {
          const dPrev = Math.abs(p.midi - prev.midi);
          const dNext = Math.abs(p.midi - next.midi);
          const dPrevNext = Math.abs(next.midi - prev.midi);
          // 自分だけ前後から大きく離れていて、前後同士は近い（＝自分が孤立した飛び値）
          if (dPrev > 1.5 && dNext > 1.5 && dPrevNext < 1.0) {
            return Object.assign({}, p, { voiced: false });
          }
        }
        return p;
      });
    }

    return filtered;
  }

  // ---------- 音程ズレハイライト ----------
  // フィルタ後のtrackを対象に、「同じノート(半音)を最低保持期間以上維持している
  // 区間」を検出し、その区間内の平均セントズレが閾値を超えていたら
  // {startT, endT} の赤帯として返す。
  // 「同じノート(半音)が最低期間以上続いている区間」を検出する共通関数。
  // ズレハイライト・ビブラート判定・スコア計算のすべてがこれを土台にする。
  // 返り値: [{ startT, endT, startIdx, endIdx }]  (endIdxは含む・voicedな最後の点)
  function detectSustainedRegions(track, minDurationSec) {
    if (!track.length) return [];
    const regions = [];
    let i = 0;
    while (i < track.length) {
      if (!track[i].voiced) { i++; continue; }
      const note = Math.round(track[i].midi);
      let j = i;
      while (j < track.length) {
        const p = track[j];
        if (p.voiced && Math.round(p.midi) !== note) break;
        j++;
      }
      let end = j - 1;
      while (end > i && !track[end].voiced) end--;

      const startT = track[i].t;
      const endT = track[end].t;
      if (endT - startT >= minDurationSec) {
        regions.push({ startT: startT, endT: endT, startIdx: i, endIdx: end });
      }
      i = j;
    }
    return regions;
  }

  // 維持区間内が「ビブラート」かどうかを判定する。
  // セント値の符号反転（山→谷）の間隔から揺れの周期(Hz)を推定し、
  // 設定範囲内の周期・十分な振幅で規則的に揺れていればビブラートとみなす。
  function isVibrato(track, startIdx, endIdx) {
    const pts = [];
    for (let k = startIdx; k <= endIdx; k++) {
      if (track[k].voiced) pts.push(track[k]);
    }
    if (pts.length < 6) return false;

    // 符号反転（ゼロクロス）の位置（時刻）を集める
    const crossings = [];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1].cents, b = pts[k].cents;
      if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) crossings.push(pts[k].t);
    }
    if (crossings.length < 3) return false; // 往復2回分未満では周期性を判断できない

    // ゼロクロス間隔の半分の逆数 ≒ 揺れの周波数(Hz)
    const halfPeriods = [];
    for (let k = 1; k < crossings.length; k++) halfPeriods.push(crossings[k] - crossings[k - 1]);
    const avgHalfPeriod = halfPeriods.reduce(function (a, b) { return a + b; }, 0) / halfPeriods.length;
    if (avgHalfPeriod <= 0) return false;
    const rateHz = 1 / (avgHalfPeriod * 2);

    // 振幅（セントの絶対値の平均）が十分あるか
    const avgAbsCents = pts.reduce(function (a, p) { return a + Math.abs(p.cents); }, 0) / pts.length;

    return rateHz >= filterSettings.vibratoMinRateHz &&
           rateHz <= filterSettings.vibratoMaxRateHz &&
           avgAbsCents >= filterSettings.vibratoMinCents;
  }

  function detectDriftRegions(track) {
    if (!filterSettings.pitchDriftEnabled || !track.length) return [];
    const minDurationSec = filterSettings.pitchDriftDurationMs / 1000;
    const centsThreshold = filterSettings.pitchDriftCents;
    const sustained = detectSustainedRegions(track, minDurationSec);
    const regions = [];
    sustained.forEach(function (r) {
      if (filterSettings.vibratoEnabled && isVibrato(track, r.startIdx, r.endIdx)) return; // ビブラートは誤検出防止のため除外
      let sum = 0, count = 0;
      for (let k = r.startIdx; k <= r.endIdx; k++) {
        if (track[k].voiced) { sum += track[k].cents; count++; }
      }
      if (count > 0 && Math.abs(sum / count) > centsThreshold) {
        regions.push({ startT: r.startT, endT: r.endT });
      }
    });
    return regions;
  }

  // ビブラートと判定された維持区間だけを抽出（ロール上に専用色で表示するため）
  function detectVibratoRegions(track) {
    if (!filterSettings.vibratoEnabled || !track.length) return [];
    const minDurationSec = filterSettings.pitchDriftDurationMs / 1000;
    const sustained = detectSustainedRegions(track, minDurationSec);
    const regions = [];
    sustained.forEach(function (r) {
      if (isVibrato(track, r.startIdx, r.endIdx)) {
        regions.push({ startT: r.startT, endT: r.endT });
      }
    });
    return regions;
  }

  // スコア計算：維持区間のうち、ビブラートを除いて平均ズレが閾値以内の割合(%)
  function calcScore(track) {
    const minDurationSec = filterSettings.pitchDriftDurationMs / 1000;
    const sustained = detectSustainedRegions(track, minDurationSec);
    const scoredRegions = filterSettings.vibratoEnabled
      ? sustained.filter(function (r) { return !isVibrato(track, r.startIdx, r.endIdx); })
      : sustained;
    if (!scoredRegions.length) return null; // 判定対象がなければスコアなし

    let okCount = 0;
    scoredRegions.forEach(function (r) {
      let sum = 0, count = 0;
      for (let k = r.startIdx; k <= r.endIdx; k++) {
        if (track[k].voiced) { sum += track[k].cents; count++; }
      }
      if (count > 0 && Math.abs(sum / count) <= filterSettings.scoreCentsThreshold) okCount++;
    });
    return Math.round((okCount / scoredRegions.length) * 100);
  }

  function redraw() {
    drawBackground();

    // メトロノームの小節線：録音の有無に関わらず、現在のロール表示幅全体に描画する
    const beatLines = getMetronomeBeatLines(canvasWidth / PIXELS_PER_SEC);
    if (beatLines.length) {
      beatLines.forEach(function (bl) {
        const x = bl.t * PIXELS_PER_SEC;
        ctx.strokeStyle = bl.isDownbeat ? 'rgba(240, 240, 245, 0.5)' : 'rgba(240, 240, 245, 0.18)';
        ctx.lineWidth = bl.isDownbeat ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();
      });
    }

    if (pitchTrack.length < 2) { drawVolumeLine(); return; }

    const track = applyFilters(pitchTrack);

    // ビブラート区間：紫の背景（ズレハイライトより先に描画し、ズレハイライトを優先表示させる）
    const vibratoRegions = detectVibratoRegions(track);
    if (vibratoRegions.length) {
      ctx.fillStyle = 'rgba(167, 139, 250, 0.18)';
      vibratoRegions.forEach(function (r) {
        const x1 = r.startT * PIXELS_PER_SEC;
        const x2 = r.endT * PIXELS_PER_SEC;
        ctx.fillRect(x1, 0, Math.max(2, x2 - x1), canvasHeight);
      });
    }

    // 音程ズレハイライト：赤帯を線より先に描画（背景として敷く）
    const driftRegions = detectDriftRegions(track);
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
      syncVolumeCanvasWidth();
      redraw();
    }
  }

  // ---------- 音量ライン（RMS波形、ピッチロールと横幅・横スクロールを同期） ----------
  function syncVolumeCanvasWidth() {
    volumeCanvas.width = canvasWidth;
    const h = volumeCanvas.parentElement.clientHeight || 40;
    volumeCanvas.height = h;
    volumeCanvas.style.height = h + 'px';
  }

  function drawVolumeLine() {
    const w = volumeCanvas.width;
    const h = volumeCanvas.height;
    volCtx.clearRect(0, 0, w, h);

    // 中央の基準線
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
      const level = Math.max(0, Math.min(1, rms * 4)); // 見やすさのため軽く増幅
      const x = p.t * PIXELS_PER_SEC;
      const y = h - level * (h - 2) - 1;
      if (!started) { volCtx.moveTo(x, y); started = true; }
      else { volCtx.lineTo(x, y); }
    }
    volCtx.stroke();
  }

  // ---------- 縦スクロール同期（キャンバス⇄鍵盤ラベル列） ----------
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

  // ---------- 再生カーソル ----------
  const rollContent = document.getElementById('rollContent');
  let cursorEl = null;
  function ensureCursorEl() {
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.className = 'playback-cursor';
      rollContent.appendChild(cursorEl);
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
  let pendingRecording = null; // 録音直後・未保存の録音 { blob, pitchTrack, duration, score, name }

  // ---------- 基準ピッチ再生（ドローン） ----------
  // マイク用audioCtxとは独立させる：録音のたびにaudioCtxを破棄/再生成するため、
  // ドローン再生中に録音を開始/停止してもドローン音が途切れないようにする。
  let droneCtx = null;
  let droneOsc = null;
  let droneGain = null;

  function midiFromKeyRootAndOctave() {
    // オクターブ表記はMIDIオクターブ（C3ならmidi 48相当）に合わせる。C4=60を基準に計算。
    return keySettings.keyRoot + (keySettings.droneOctave + 1) * 12;
  }
  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  function startDrone() {
    if (droneCtx) return;
    droneCtx = new (window.AudioContext || window.webkitAudioContext)();
    droneOsc = droneCtx.createOscillator();
    droneGain = droneCtx.createGain();
    droneOsc.type = 'sine';
    droneOsc.frequency.value = midiToFreq(midiFromKeyRootAndOctave());
    droneGain.gain.value = 0; // クリックノイズ防止のため0から立ち上げる
    droneOsc.connect(droneGain);
    droneGain.connect(droneCtx.destination);
    droneOsc.start();
    droneGain.gain.linearRampToValueAtTime(0.18, droneCtx.currentTime + 0.05);
  }
  function stopDrone() {
    if (!droneCtx) return;
    const ctxToClose = droneCtx;
    const oscToStop = droneOsc;
    const gainToRelease = droneGain;
    droneCtx = null;
    droneOsc = null;
    droneGain = null;
    try {
      gainToRelease.gain.linearRampToValueAtTime(0, ctxToClose.currentTime + 0.05);
      setTimeout(function () {
        try { oscToStop.stop(); } catch (e) { /* 既に停止済みの場合は無視 */ }
        ctxToClose.close();
      }, 80);
    } catch (e) {
      try { oscToStop.stop(); } catch (e2) { /* 無視 */ }
      ctxToClose.close();
    }
  }
  function updateDroneFrequency() {
    if (droneOsc) {
      droneOsc.frequency.setValueAtTime(midiToFreq(midiFromKeyRootAndOctave()), droneCtx.currentTime);
    }
  }

  // ---------- ノートラベルのタップ発音（左側の鍵盤ラベルを押している間、その音を鳴らす） ----------
  let keyPressCtx = null;
  let keyPressOsc = null;
  let keyPressGain = null;

  function startKeyPressTone(midi) {
    stopKeyPressTone();
    keyPressCtx = new (window.AudioContext || window.webkitAudioContext)();
    keyPressOsc = keyPressCtx.createOscillator();
    keyPressGain = keyPressCtx.createGain();
    keyPressOsc.type = 'sine';
    keyPressOsc.frequency.value = midiToFreq(midi);
    keyPressGain.gain.value = 0; // クリックノイズ防止のため0から立ち上げる
    keyPressOsc.connect(keyPressGain);
    keyPressGain.connect(keyPressCtx.destination);
    keyPressOsc.start();
    keyPressGain.gain.linearRampToValueAtTime(0.22, keyPressCtx.currentTime + 0.03);

    activeKeyPressMidi = midi;
    redraw();
  }

  function stopKeyPressTone() {
    if (keyPressCtx) {
      const ctxToClose = keyPressCtx;
      const oscToStop = keyPressOsc;
      const gainToRelease = keyPressGain;
      keyPressCtx = null;
      keyPressOsc = null;
      keyPressGain = null;
      try {
        gainToRelease.gain.linearRampToValueAtTime(0, ctxToClose.currentTime + 0.05);
        setTimeout(function () {
          try { oscToStop.stop(); } catch (e) { /* 既に停止済みの場合は無視 */ }
          ctxToClose.close();
        }, 80);
      } catch (e) {
        try { oscToStop.stop(); } catch (e2) { /* 無視 */ }
        try { ctxToClose.close(); } catch (e3) { /* 無視 */ }
      }
    }
    if (activeKeyPressMidi !== null) {
      activeKeyPressMidi = null;
      redraw();
    }
  }

  // ---------- 簡易メトロノーム ----------
  // ドローンと同様、マイク用audioCtxとは独立したAudioContextでクリック音をスケジューリング再生する。
  // ロールへの小節線描画は、録音のタイムライン(t秒)全体に対して周期的に拍位置を計算する方式にすることで、
  // 「メトロノームを録音前から鳴らしていても、録音開始後のロールに正しく線が乗る」ようにしている。
  let metroCtx = null;
  let metroTimerId = null;
  let metroNextBeatTime = 0;   // 次に鳴らす拍のAudioContext上の時刻
  let metroBeatIndex = 0;      // 小節内の拍番号(0=小節先頭)
  let metroStartPerf = 0;      // メトロノームを開始したperformance.now()（ロール描画の基準用）
  const METRO_SCHEDULE_AHEAD = 0.1; // 先読みスケジュール幅(秒)
  const METRO_INTERVAL_MS = 25;     // スケジューラのチェック間隔(ms)

  function scheduleClick(time, isDownbeat) {
    const osc = metroCtx.createOscillator();
    const gain = metroCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = isDownbeat ? 1500 : 1000; // 小節先頭は高音、それ以外は低音
    const vol = tempoSettings.volume * (isDownbeat ? 1.0 : 0.7);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    osc.connect(gain);
    gain.connect(metroCtx.destination);
    osc.start(time);
    osc.stop(time + 0.08);
  }

  function metroScheduler() {
    const beatSec = 60 / tempoSettings.bpm;
    while (metroNextBeatTime < metroCtx.currentTime + METRO_SCHEDULE_AHEAD) {
      scheduleClick(metroNextBeatTime, metroBeatIndex === 0);
      metroBeatIndex = (metroBeatIndex + 1) % tempoSettings.beatsPerBar;
      metroNextBeatTime += beatSec;
    }
  }

  function startMetronome() {
    if (metroCtx) return;
    metroCtx = new (window.AudioContext || window.webkitAudioContext)();
    metroBeatIndex = 0;
    metroNextBeatTime = metroCtx.currentTime + 0.05;
    metroStartPerf = performance.now();
    metroScheduler();
    metroTimerId = setInterval(metroScheduler, METRO_INTERVAL_MS);
  }
  function stopMetronome() {
    if (!metroCtx) return;
    if (metroTimerId) { clearInterval(metroTimerId); metroTimerId = null; }
    const ctxToClose = metroCtx;
    metroCtx = null;
    ctxToClose.close();
  }

  // 録音のタイムライン座標(t秒, 0〜durationSec)上で、ロールに描くべき拍位置(t)の配列を返す。
  // { t, isDownbeat } のリスト。メトロノーム未使用時は空配列。
  function getMetronomeBeatLines(durationSec) {
    if (!metronomeEnabled || !metroCtx || durationSec <= 0) return [];
    const beatSec = 60 / tempoSettings.bpm;
    // メトロノーム開始時点(metroStartPerf)が、録音タイムライン上のどの時刻(t)に当たるかを求める。
    const metroStartT = (metroStartPerf - startTime) / 1000;

    // durationSec全体をカバーするよう、metroStartTを基準に整数倍だけずらして拍位置を列挙する。
    const lines = [];
    const startIdx = Math.floor((0 - metroStartT) / beatSec) - 1;
    const endIdx = Math.ceil((durationSec - metroStartT) / beatSec) + 1;
    for (let idx = startIdx; idx <= endIdx; idx++) {
      const t = metroStartT + idx * beatSec;
      if (t < 0 || t > durationSec) continue;
      const beatPos = ((idx % tempoSettings.beatsPerBar) + tempoSettings.beatsPerBar) % tempoSettings.beatsPerBar;
      lines.push({ t: t, isDownbeat: beatPos === 0 });
    }
    return lines;
  }

  let mediaRecorder = null;
  let recordedChunks = [];

  function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return { freq: -1, rms: rms };

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
    if (T0 <= 0) return { freq: -1, rms: rms };

    const x1 = c[T0 - 1] || c[T0];
    const x2 = c[T0];
    const x3 = c[T0 + 1] || c[T0];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    const freq = sampleRate / T0;
    if (freq < 50 || freq > 1200) return { freq: -1, rms: rms };
    return { freq: freq, rms: rms };
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
    const result = autoCorrelate(buf, audioCtx.sampleRate);
    const freq = result.freq;
    const rms = result.rms;
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

      pitchTrack.push({ t, midi, cents, rms, voiced: true });
    } else {
      noteReadout.textContent = '--';
      centsReadout.className = 'cents-readout';
      centsReadout.textContent = '-- ¢';
      pitchTrack.push({ t, midi: 0, cents: 0, rms, voiced: false });
    }

    ensureWidth(t);
    redraw();
    rollScroll.scrollLeft = t * PIXELS_PER_SEC - rollScroll.clientWidth + 120;

    rafId = requestAnimationFrame(analyzeLoop);
  }

  async function beginRecording() {
    // 前回の録音が未保存のまま残っている場合、新しい録音を始めた時点で破棄する
    pendingRecording = null;
    updateSaveBtnState();
    stopKeyPressTone(); // 押しっぱなしのノートタップ音があれば止める

    // 毎回マイクを取得し直す：一度停止したMediaRecorder/streamを使い回すと、
    // ブラウザによっては2回目以降のdataavailableが発火せず録音が空になる
    // ことがあるため、録音のたびに新しいgetUserMediaストリームを張り直す。
    if (mediaStream) { mediaStream.getTracks().forEach(function (t) { t.stop(); }); mediaStream = null; }
    if (audioCtx) { await audioCtx.close(); audioCtx = null; }
    await startMic();
    recording = true;
    pitchTrack = [];
    canvasWidth = PIXELS_PER_SEC * initialBufferSec;
    setupSize();
    startTime = performance.now();

    recordedChunks = [];
    const mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm')) ? 'audio/webm' : '';
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) recordedChunks.push(e.data); };
    // timesliceを指定して定期的にdataavailableを発火させる（stop時の一括発火に
    // 依存しないことで取りこぼしを防ぐ）
    mediaRecorder.start(250);

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
    statusHint.classList.remove('live');

    const finalTrack = pitchTrack.slice();

    await new Promise((resolve) => {
      mediaRecorder.onstop = resolve;
      mediaRecorder.stop();
    });

    // 録音に使ったストリームはここで明示的に停止・解放する。
    // 次の録音はbeginRecordingで新しく取得し直す。
    if (mediaStream) { mediaStream.getTracks().forEach(function (t) { t.stop(); }); mediaStream = null; }
    if (audioCtx) { await audioCtx.close(); audioCtx = null; }

    const blob = new Blob(recordedChunks, { type: (recordedChunks[0] && recordedChunks[0].type) || 'audio/webm' });
    const duration = finalTrack.length ? finalTrack[finalTrack.length - 1].t : 0;
    const defaultName = makeRecordingName();
    const score = calcScore(applyFilters(finalTrack));

    // 保存はここでは行わず、いったん保留（未保存）の状態で即座に再生できるようにする。
    // 保存するかどうかはユーザーがSAVEボタンを押したときに決める。
    pendingRecording = { blob, pitchTrack: finalTrack, duration, score, name: defaultName };
    updateSaveBtnState();
    statusHint.textContent = '録音完了 — 再生できます（保存するにはSAVE）';
    selectRecording({ id: null, name: defaultName, blob, pitchTrack: finalTrack, duration, score });
  }

  // ---------- SAVEボタン：保留中の録音をIndexedDBに保存 ----------
  function updateSaveBtnState() {
    saveBtn.disabled = !pendingRecording;
  }

  saveBtn.addEventListener('click', async () => {
    if (!pendingRecording) return;
    const rec = pendingRecording;
    const chosenName = await openSaveDialog(rec.name);
    if (chosenName === null) return; // キャンセル：保留のまま維持（破棄しない）

    try {
      const newId = await dbAddRecording({ name: chosenName, blob: rec.blob, pitchTrack: rec.pitchTrack, duration: rec.duration, score: rec.score, createdAt: Date.now() });
      statusHint.textContent = '「' + chosenName + '」を保存しました';
      pendingRecording = null;
      updateSaveBtnState();
      // 再生中の名前表示も保存後の名前に更新する
      if (currentPlayback) {
        currentPlayback.id = newId;
        pbName.textContent = chosenName;
      }
      refreshRecList();
    } catch (err) {
      console.error(err);
      statusHint.textContent = '保存に失敗しました';
    }
  });

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

  function openClearConfirm() {
    return new Promise((resolve) => {
      clearConfirmBackdrop.classList.add('open');
      clearConfirmPopup.classList.add('open');

      function cleanup() {
        clearConfirmBackdrop.classList.remove('open');
        clearConfirmPopup.classList.remove('open');
        clearConfirmOkBtn.removeEventListener('click', onOk);
        clearConfirmCancelBtn.removeEventListener('click', onCancel);
        clearConfirmBackdrop.removeEventListener('click', onCancel);
      }
      function onOk() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      clearConfirmOkBtn.addEventListener('click', onOk);
      clearConfirmCancelBtn.addEventListener('click', onCancel);
      clearConfirmBackdrop.addEventListener('click', onCancel);
    });
  }

  clearBtn.addEventListener('click', async () => {
    if (recording) return;
    const confirmed = await openClearConfirm();
    if (!confirmed) return;

    stopPlayback();
    pendingRecording = null;
    updateSaveBtnState();

    pitchTrack = [];
    canvasWidth = PIXELS_PER_SEC * initialBufferSec;
    setupSize();
    redraw();
    noteReadout.textContent = '--';
    centsReadout.className = 'cents-readout';
    centsReadout.textContent = '-- ¢';
    rollScroll.scrollLeft = 0;
    volumeScroll.scrollLeft = 0;
    statusHint.textContent = 'マイク未接続 — RECを押して開始';
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
      let metaText = formatDateTime(rec.createdAt) + ' ・ ' + formatDuration(rec.duration);
      if (rec.score !== null && rec.score !== undefined) {
        metaText += ' ・ ' + rec.score + '%';
      }
      metaEl.textContent = metaText;
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

  function openRecListModal() {
    recListBackdrop.classList.add('open');
    recListPopup.classList.add('open');
    listBtn.classList.add('active');
    refreshRecList();
  }
  function closeRecListModal() {
    recListBackdrop.classList.remove('open');
    recListPopup.classList.remove('open');
    listBtn.classList.remove('active');
  }

  listBtn.addEventListener('click', openRecListModal);
  recListCloseBtn.addEventListener('click', closeRecListModal);
  recListBackdrop.addEventListener('click', closeRecListModal);

  // ============================================================
  // ノイズ除去フィルタ設定モーダル
  // ============================================================
  function reflectFilterSettingsToUI() {
    jumpWindowInput.value = filterSettings.jumpWindowMs;
    jumpWindowValue.textContent = filterSettings.jumpWindowMs;
    jumpSemitonesInput.value = filterSettings.jumpSemitones;
    jumpSemitonesValue.textContent = filterSettings.jumpSemitones;
    spikeToggle.setAttribute('aria-checked', filterSettings.spikeRemoval ? 'true' : 'false');
    rmsThresholdInput.value = filterSettings.rmsThreshold;
    rmsThresholdValue.textContent = filterSettings.rmsThreshold.toFixed(2);
    pitchDriftToggle.setAttribute('aria-checked', filterSettings.pitchDriftEnabled ? 'true' : 'false');
    pitchDriftDurationInput.value = filterSettings.pitchDriftDurationMs;
    pitchDriftDurationValue.textContent = filterSettings.pitchDriftDurationMs;
    pitchDriftCentsInput.value = filterSettings.pitchDriftCents;
    pitchDriftCentsValue.textContent = filterSettings.pitchDriftCents;
    vibratoToggle.setAttribute('aria-checked', filterSettings.vibratoEnabled ? 'true' : 'false');
    vibratoMinRateInput.value = filterSettings.vibratoMinRateHz;
    vibratoMinRateValue.textContent = filterSettings.vibratoMinRateHz.toFixed(1);
    vibratoMaxRateInput.value = filterSettings.vibratoMaxRateHz;
    vibratoMaxRateValue.textContent = filterSettings.vibratoMaxRateHz.toFixed(1);
    vibratoMinCentsInput.value = filterSettings.vibratoMinCents;
    vibratoMinCentsValue.textContent = filterSettings.vibratoMinCents;
    scoreCentsInput.value = filterSettings.scoreCentsThreshold;
    scoreCentsValue.textContent = filterSettings.scoreCentsThreshold;
  }

  let settingsSnapshot = null; // モーダルを開いた時点の設定値（CANCELでここに戻す）

  function openSettingsModal() {
    settingsSnapshot = Object.assign({}, filterSettings);
    reflectFilterSettingsToUI();
    settingsBackdrop.classList.add('open');
    settingsPopup.classList.add('open');
    settingsBtn.classList.add('active');
  }
  function closeSettingsModal() {
    settingsBackdrop.classList.remove('open');
    settingsPopup.classList.remove('open');
    settingsBtn.classList.remove('active');
  }
  function cancelSettingsModal() {
    if (settingsSnapshot) {
      filterSettings = Object.assign({}, settingsSnapshot);
      saveFilterSettings();
      reflectFilterSettingsToUI();
      redraw();
    }
    closeSettingsModal();
  }

  settingsBtn.addEventListener('click', openSettingsModal);
  settingsCloseBtn.addEventListener('click', closeSettingsModal);
  settingsCancelBtn.addEventListener('click', cancelSettingsModal);
  settingsBackdrop.addEventListener('click', closeSettingsModal);

  // ---------- キー・スケール＆ドローン設定モーダル ----------
  function reflectKeySettingsToUI() {
    keyHighlightToggle.setAttribute('aria-checked', keySettings.keyHighlightEnabled ? 'true' : 'false');
    keyRootSelect.value = String(keySettings.keyRoot);
    keyModeSelect.value = keySettings.keyMode;
    droneToggle.setAttribute('aria-checked', droneEnabled ? 'true' : 'false');
    droneOctaveInput.value = keySettings.droneOctave;
    droneOctaveValue.textContent = keySettings.droneOctave;
  }
  function openKeyModal() {
    reflectKeySettingsToUI();
    closeSettingsModal();
    keyBackdrop.classList.add('open');
    keyPopup.classList.add('open');
  }
  function closeKeyModal() {
    keyBackdrop.classList.remove('open');
    keyPopup.classList.remove('open');
  }
  keyBtn.addEventListener('click', openKeyModal);
  keyCloseBtn.addEventListener('click', closeKeyModal);
  keyBackdrop.addEventListener('click', closeKeyModal);

  keyHighlightToggle.addEventListener('click', function () {
    keySettings.keyHighlightEnabled = !keySettings.keyHighlightEnabled;
    keyHighlightToggle.setAttribute('aria-checked', keySettings.keyHighlightEnabled ? 'true' : 'false');
    saveKeySettings();
    redraw();
  });
  keyRootSelect.addEventListener('change', function () {
    keySettings.keyRoot = parseInt(keyRootSelect.value, 10);
    saveKeySettings();
    updateDroneFrequency();
    redraw();
  });
  keyModeSelect.addEventListener('change', function () {
    keySettings.keyMode = keyModeSelect.value;
    saveKeySettings();
    redraw();
  });
  droneToggle.addEventListener('click', function () {
    droneEnabled = !droneEnabled;
    droneToggle.setAttribute('aria-checked', droneEnabled ? 'true' : 'false');
    if (droneEnabled) startDrone(); else stopDrone();
  });
  droneOctaveInput.addEventListener('input', function () {
    const v = parseInt(droneOctaveInput.value, 10);
    keySettings.droneOctave = isNaN(v) ? KEY_DEFAULTS.droneOctave : Math.max(1, Math.min(6, v));
    droneOctaveValue.textContent = keySettings.droneOctave;
    saveKeySettings();
    updateDroneFrequency();
  });

  // ---------- メトロノームモーダル ----------
  function reflectTempoSettingsToUI() {
    metronomeToggle.setAttribute('aria-checked', metronomeEnabled ? 'true' : 'false');
    tempoBeatsSelect.value = String(tempoSettings.beatsPerBar);
    tempoBpmInput.value = tempoSettings.bpm;
    tempoBpmValue.textContent = tempoSettings.bpm;
    tempoVolumeInput.value = tempoSettings.volume;
    tempoVolumeValue.textContent = tempoSettings.volume.toFixed(2);
  }
  function openTempoModal() {
    reflectTempoSettingsToUI();
    tempoBackdrop.classList.add('open');
    tempoPopup.classList.add('open');
    tempoBtn.classList.add('active');
  }
  function closeTempoModal() {
    tempoBackdrop.classList.remove('open');
    tempoPopup.classList.remove('open');
    tempoBtn.classList.remove('active');
  }
  tempoBtn.addEventListener('click', openTempoModal);
  tempoCloseBtn.addEventListener('click', closeTempoModal);
  tempoBackdrop.addEventListener('click', closeTempoModal);

  metronomeToggle.addEventListener('click', function () {
    metronomeEnabled = !metronomeEnabled;
    metronomeToggle.setAttribute('aria-checked', metronomeEnabled ? 'true' : 'false');
    if (metronomeEnabled) startMetronome(); else stopMetronome();
    redraw();
  });
  tempoBeatsSelect.addEventListener('change', function () {
    tempoSettings.beatsPerBar = parseInt(tempoBeatsSelect.value, 10);
    saveTempoSettings();
    redraw();
  });
  tempoBpmInput.addEventListener('input', function () {
    const v = parseInt(tempoBpmInput.value, 10);
    tempoSettings.bpm = isNaN(v) ? TEMPO_DEFAULTS.bpm : Math.max(40, Math.min(240, v));
    tempoBpmValue.textContent = tempoSettings.bpm;
    saveTempoSettings();
    redraw();
  });
  tempoVolumeInput.addEventListener('input', function () {
    const v = parseFloat(tempoVolumeInput.value);
    tempoSettings.volume = isNaN(v) ? TEMPO_DEFAULTS.volume : Math.max(0, Math.min(1, v));
    tempoVolumeValue.textContent = tempoSettings.volume.toFixed(2);
    saveTempoSettings();
  });

  // スライダーはinputイベントでドラッグ中もリアルタイムに反映する
  jumpWindowInput.addEventListener('input', function () {
    const v = parseInt(jumpWindowInput.value, 10);
    filterSettings.jumpWindowMs = isNaN(v) ? FILTER_DEFAULTS.jumpWindowMs : Math.max(0, Math.min(500, v));
    jumpWindowValue.textContent = filterSettings.jumpWindowMs;
    saveFilterSettings();
    redraw();
  });
  jumpSemitonesInput.addEventListener('input', function () {
    const v = parseInt(jumpSemitonesInput.value, 10);
    filterSettings.jumpSemitones = isNaN(v) ? FILTER_DEFAULTS.jumpSemitones : Math.max(0, Math.min(12, v));
    jumpSemitonesValue.textContent = filterSettings.jumpSemitones;
    saveFilterSettings();
    redraw();
  });
  rmsThresholdInput.addEventListener('input', function () {
    const v = parseFloat(rmsThresholdInput.value);
    filterSettings.rmsThreshold = isNaN(v) ? FILTER_DEFAULTS.rmsThreshold : Math.max(0, Math.min(0.5, Math.round(v * 100) / 100));
    rmsThresholdValue.textContent = filterSettings.rmsThreshold.toFixed(2);
    saveFilterSettings();
    redraw();
  });
  spikeToggle.addEventListener('click', function () {
    filterSettings.spikeRemoval = !filterSettings.spikeRemoval;
    spikeToggle.setAttribute('aria-checked', filterSettings.spikeRemoval ? 'true' : 'false');
    saveFilterSettings();
    redraw();
  });
  pitchDriftToggle.addEventListener('click', function () {
    filterSettings.pitchDriftEnabled = !filterSettings.pitchDriftEnabled;
    pitchDriftToggle.setAttribute('aria-checked', filterSettings.pitchDriftEnabled ? 'true' : 'false');
    saveFilterSettings();
    redraw();
  });
  pitchDriftDurationInput.addEventListener('input', function () {
    const v = parseInt(pitchDriftDurationInput.value, 10);
    filterSettings.pitchDriftDurationMs = isNaN(v) ? FILTER_DEFAULTS.pitchDriftDurationMs : Math.max(100, Math.min(2000, v));
    pitchDriftDurationValue.textContent = filterSettings.pitchDriftDurationMs;
    saveFilterSettings();
    redraw();
  });
  pitchDriftCentsInput.addEventListener('input', function () {
    const v = parseInt(pitchDriftCentsInput.value, 10);
    filterSettings.pitchDriftCents = isNaN(v) ? FILTER_DEFAULTS.pitchDriftCents : Math.max(1, Math.min(50, v));
    pitchDriftCentsValue.textContent = filterSettings.pitchDriftCents;
    saveFilterSettings();
    redraw();
  });
  vibratoToggle.addEventListener('click', function () {
    filterSettings.vibratoEnabled = !filterSettings.vibratoEnabled;
    vibratoToggle.setAttribute('aria-checked', filterSettings.vibratoEnabled ? 'true' : 'false');
    saveFilterSettings();
    redraw();
  });
  vibratoMinRateInput.addEventListener('input', function () {
    const v = parseFloat(vibratoMinRateInput.value);
    filterSettings.vibratoMinRateHz = isNaN(v) ? FILTER_DEFAULTS.vibratoMinRateHz : Math.max(1, Math.min(10, v));
    vibratoMinRateValue.textContent = filterSettings.vibratoMinRateHz.toFixed(1);
    saveFilterSettings();
    redraw();
  });
  vibratoMaxRateInput.addEventListener('input', function () {
    const v = parseFloat(vibratoMaxRateInput.value);
    filterSettings.vibratoMaxRateHz = isNaN(v) ? FILTER_DEFAULTS.vibratoMaxRateHz : Math.max(1, Math.min(12, v));
    vibratoMaxRateValue.textContent = filterSettings.vibratoMaxRateHz.toFixed(1);
    saveFilterSettings();
    redraw();
  });
  vibratoMinCentsInput.addEventListener('input', function () {
    const v = parseInt(vibratoMinCentsInput.value, 10);
    filterSettings.vibratoMinCents = isNaN(v) ? FILTER_DEFAULTS.vibratoMinCents : Math.max(5, Math.min(50, v));
    vibratoMinCentsValue.textContent = filterSettings.vibratoMinCents;
    saveFilterSettings();
    redraw();
  });
  scoreCentsInput.addEventListener('input', function () {
    const v = parseInt(scoreCentsInput.value, 10);
    filterSettings.scoreCentsThreshold = isNaN(v) ? FILTER_DEFAULTS.scoreCentsThreshold : Math.max(1, Math.min(50, v));
    scoreCentsValue.textContent = filterSettings.scoreCentsThreshold;
    saveFilterSettings();
  });
  settingsResetBtn.addEventListener('click', function () {
    filterSettings = Object.assign({}, FILTER_DEFAULTS);
    reflectFilterSettingsToUI();
    saveFilterSettings();
    redraw();
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
    setupSize();
    redraw();
  }

  function selectRecording(rec) {
    if (recording) return;
    // 保存済みの録音（idを持つ）に切り替える場合は、保留中の未保存録音を破棄する
    if (rec.id) {
      pendingRecording = null;
      updateSaveBtnState();
    }
    stopPlayback();

    const url = URL.createObjectURL(rec.blob);
    const audio = new Audio(url);
    currentPlayback = { id: rec.id, audio: audio, rafId: null };

    pitchTrack = rec.pitchTrack;
    canvasWidth = Math.max(PIXELS_PER_SEC * initialBufferSec, (rec.duration + 5) * PIXELS_PER_SEC);

    pbName.textContent = rec.name;
    pbScore.textContent = (rec.score !== null && rec.score !== undefined) ? ('SCORE ' + rec.score + '%') : '';
    pbProgressFill.style.width = '0%';
    pbInfoRow.classList.add('open');
    playToggleBtn.disabled = false;

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
    closeRecListModal();
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
  updateSaveBtnState();
})();
