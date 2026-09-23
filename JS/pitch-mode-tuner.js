// ============================================================
// pitch-mode-tuner.js
// TUNERMODE：Mic Tuner・Tone Generator（サブ切替え）。
// md/AI_ASSISTANT_PROJECT_CONTEXT.md §0-3の通り、大分類はTUNER/PITCH
// の2つのみで、Tone GeneratorはTUNERMODE内のサブ切替え。
//
// 【移植元】旧QNTUNER(player.js)のMic Tuner・Tone Generatorロジックを
// 移植。ピッチ検出（autoCorrelate）・音名変換は重複させず、
// pitch-core.js の共通関数（window.QNPitch.core）を使う。
//
// パネル・メインウインドウ・下部バーは pitch-ui-pc-v2.js の登録の
// 仕組み（window.QNPitch.panels.register 等）を通じて組み込む。
// ============================================================

window.QNPitch = window.QNPitch || {};

(function () {
  const core = window.QNPitch.core;

  // ==================== プリセット定義（旧QNTUNERから移植） ====================
  const BASE_STRINGS = {
    guitar: [
      { label: 'String 1', midi: 76 }, // E5
      { label: 'String 2', midi: 71 }, // B4
      { label: 'String 3', midi: 67 }, // G4
      { label: 'String 4', midi: 62 }, // D4
      { label: 'String 5', midi: 57 }, // A3
      { label: 'String 6', midi: 52 }, // E3
    ],
    bass: [
      { label: 'String 1', midi: 55 }, // G3
      { label: 'String 2', midi: 50 }, // D3
      { label: 'String 3', midi: 45 }, // A2
      { label: 'String 4', midi: 40 }, // E2
    ],
    ukulele: [
      { label: 'String 1', midi: 69 }, // A4
      { label: 'String 2', midi: 64 }, // E4
      { label: 'String 3', midi: 60 }, // C4
      { label: 'String 4', midi: 67 }, // G4
    ],
  };

  const TUNING_VARIANTS = {
    guitar: [
      { key: 'regular', label: 'Regular', allOffset: 0, dropLastOffset: 0 },
      { key: 'half', label: 'Half Down', allOffset: -1, dropLastOffset: 0 },
      { key: 'whole', label: 'Whole Down', allOffset: -2, dropLastOffset: 0 },
      { key: 'dropD', label: 'Drop D', allOffset: 0, dropLastOffset: -2 },
      { key: 'dropCs', label: 'Drop C#', allOffset: -1, dropLastOffset: -2 },
      { key: 'dropC', label: 'Drop C', allOffset: -2, dropLastOffset: -2 },
    ],
    bass: [
      { key: 'regular', label: 'Regular', allOffset: 0, dropLastOffset: 0 },
      { key: 'half', label: 'Half Down', allOffset: -1, dropLastOffset: 0 },
      { key: 'whole', label: 'Whole Down', allOffset: -2, dropLastOffset: 0 },
      { key: 'dropD', label: 'Drop D', allOffset: 0, dropLastOffset: -2 },
      { key: 'dropCs', label: 'Drop C#', allOffset: -1, dropLastOffset: -2 },
      { key: 'dropC', label: 'Drop C', allOffset: -2, dropLastOffset: -2 },
    ],
  };

  const PRESET_ORDER = ['guitar', 'bass', 'ukulele', 'chromatic'];

  function buildStringSet(instrumentKey, variantKey) {
    const base = BASE_STRINGS[instrumentKey];
    const variants = TUNING_VARIANTS[instrumentKey];
    const variant = (variants || []).find(v => v.key === variantKey) || { allOffset: 0, dropLastOffset: 0 };
    const lastIndex = base.length - 1;
    return base.map((s, i) => {
      const offset = variant.allOffset + (i === lastIndex ? variant.dropLastOffset : 0);
      const midi = s.midi + offset;
      return { label: s.label, note: core.midiToNoteName(midi), midi };
    });
  }

  const CHROMATIC_LIST = (() => {
    const arr = [];
    for (let m = 83; m >= 48; m--) {
      arr.push({ label: core.midiToNoteName(m), note: core.midiToNoteName(m), midi: m });
    }
    return arr;
  })();

  // ==================== 状態 ====================
  let subTab = 'mic'; // "mic" | "tone"
  let currentPreset = 'guitar';
  let currentTuning = 'regular';

  // Mic Tuner関連
  let micSession = null;
  let micSensitivity = 50;
  let micSmoothing = 50;
  let micSilenceFrames = 0;
  let smoothedFreq = null;
  let smoothedAngle = 0;

  const MIC_SETTINGS_KEY = 'qnpitch_tuner_mic_settings_v1';

  function loadMicSettings() {
    try {
      const raw = localStorage.getItem(MIC_SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.sensitivity === 'number') micSensitivity = parsed.sensitivity;
        if (typeof parsed.smoothing === 'number') micSmoothing = parsed.smoothing;
      }
    } catch (e) { /* ignore */ }
  }

  function saveMicSettings() {
    try {
      localStorage.setItem(MIC_SETTINGS_KEY, JSON.stringify({ sensitivity: micSensitivity, smoothing: micSmoothing }));
    } catch (e) { /* ignore */ }
  }
  loadMicSettings();

  function silenceRmsThreshold() {
    // sensitivity 0-100: 高いほど小さい音も拾う
    return 0.03 - (micSensitivity / 100) * 0.025;
  }
  function silenceHoldFrames() {
    return Math.round(6 + (100 - micSensitivity) / 100 * 24);
  }
  function freqSmoothingFactor() {
    return 0.1 + (micSmoothing / 100) * 0.5;
  }
  function needleSmoothingFactor() {
    return 0.15 + (micSmoothing / 100) * 0.5;
  }

  // Tone Generator関連
  let toneAudioCtx = null;
  let toneOsc = null;
  let toneGain = null;
  let playingRowEl = null;

  function playTone(freq, noteLabel, rowEl) {
    stopTone();
    if (!toneAudioCtx) {
      toneAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (toneAudioCtx.state === 'suspended') toneAudioCtx.resume();

    toneOsc = toneAudioCtx.createOscillator();
    toneGain = toneAudioCtx.createGain();
    toneOsc.type = 'triangle';
    toneOsc.frequency.value = freq;
    toneGain.gain.setValueAtTime(0, toneAudioCtx.currentTime);
    toneGain.gain.linearRampToValueAtTime(0.7, toneAudioCtx.currentTime + 0.03);
    toneOsc.connect(toneGain);
    toneGain.connect(toneAudioCtx.destination);
    toneOsc.start();

    rowEl.classList.add('is-playing');
    playingRowEl = rowEl;
    updateToneNowDisplay(noteLabel, freq);
  }

  function stopTone() {
    if (toneGain && toneAudioCtx) {
      toneGain.gain.linearRampToValueAtTime(0, toneAudioCtx.currentTime + 0.03);
    }
    if (toneOsc) {
      const osc = toneOsc;
      setTimeout(() => { try { osc.stop(); } catch (e) {} }, 50);
      toneOsc = null;
    }
    if (playingRowEl) {
      playingRowEl.classList.remove('is-playing');
      playingRowEl = null;
    }
    updateToneNowDisplay(null, null);
  }

  function updateToneNowDisplay(noteLabel, freq) {
    const wrap = document.getElementById('pitchToneNow');
    if (!wrap) return;
    if (noteLabel === null) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const noteEl = document.getElementById('pitchToneNowNote');
    const freqEl = document.getElementById('pitchToneNowFreq');
    if (noteEl) noteEl.textContent = noteLabel;
    if (freqEl) freqEl.textContent = freq.toFixed(1);
  }

  // ==================== Mic Tuner：描画 ====================
  function renderMicScreen(container) {
    container.innerHTML =
      '<div id="pitchTunerMicScreen">' +
        '<div class="pitch-mic-permission" id="pitchMicPermission">' +
          '<div class="pitch-mic-permission-icon">🎙</div>' +
          '<p class="pitch-mic-permission-text">マイクへのアクセスを許可すると、リアルタイムに音程を表示します</p>' +
          '<button class="pitch-btn-primary" id="pitchBtnStartMic" type="button">Start Mic</button>' +
          '<p class="pitch-mic-permission-note" id="pitchMicErrorNote"></p>' +
        '</div>' +
        '<div class="pitch-meter-wrap" id="pitchMeterWrap" hidden>' +
          '<div class="pitch-gauge">' +
            '<svg class="pitch-gauge-svg" viewBox="0 0 300 170" aria-hidden="true">' +
              '<path class="pitch-gauge-track" d="M 20 160 A 130 130 0 0 1 280 160" />' +
              '<path class="pitch-gauge-zone-flat" d="M 20 160 A 130 130 0 0 1 95 45" />' +
              '<path class="pitch-gauge-zone-in" d="M 108 33 A 130 130 0 0 1 192 33" />' +
              '<path class="pitch-gauge-zone-sharp" d="M 205 45 A 130 130 0 0 1 280 160" />' +
              '<g id="pitchNeedle" class="pitch-needle" style="transform: rotate(0deg)">' +
                '<line x1="150" y1="160" x2="150" y2="45" />' +
                '<circle cx="150" cy="160" r="7" />' +
              '</g>' +
            '</svg>' +
            '<div class="pitch-gauge-labels"><span>♭</span><span>IN TUNE</span><span>♯</span></div>' +
          '</div>' +
          '<div class="pitch-reading">' +
            '<div class="pitch-note-display" id="pitchNoteDisplay">—</div>' +
            '<div class="pitch-freq-display"><span id="pitchFreqValue">0.0</span> Hz</div>' +
            '<div class="pitch-cents-display" id="pitchCentsDisplay">Play a note</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    const btnStart = document.getElementById('pitchBtnStartMic');
    if (btnStart) btnStart.addEventListener('click', () => startMic());

    // 初回自動起動を試みる（拒否されても通常のボタン導線にフォールバック）
    startMic(true);
  }

  async function startMic(auto) {
    const errorNote = document.getElementById('pitchMicErrorNote');
    if (errorNote) errorNote.textContent = '';

    micSession = core.createAnalysisSession({
      fftSize: 2048,
      onFrame(result) {
        handleMicFrame(result.freq);
      }
    });

    try {
      await micSession.startFromMic();
    } catch (err) {
      if (!auto && errorNote) errorNote.textContent = 'マイクへのアクセスが許可されませんでした';
      micSession = null;
      return;
    }

    const permEl = document.getElementById('pitchMicPermission');
    const meterEl = document.getElementById('pitchMeterWrap');
    if (permEl) permEl.hidden = true;
    if (meterEl) meterEl.hidden = false;
  }

  function stopMic() {
    if (micSession) {
      micSession.stop();
      micSession = null;
    }
    const permEl = document.getElementById('pitchMicPermission');
    const meterEl = document.getElementById('pitchMeterWrap');
    if (meterEl) meterEl.hidden = true;
    if (permEl) permEl.hidden = false;
    resetMicReadout();
  }

  function resetMicReadout() {
    const needle = document.getElementById('pitchNeedle');
    const noteDisplay = document.getElementById('pitchNoteDisplay');
    const freqValue = document.getElementById('pitchFreqValue');
    const centsDisplay = document.getElementById('pitchCentsDisplay');
    const meterWrap = document.getElementById('pitchMeterWrap');
    if (needle) needle.style.transform = 'rotate(0deg)';
    if (noteDisplay) noteDisplay.textContent = '—';
    if (freqValue) freqValue.textContent = '0.0';
    if (centsDisplay) centsDisplay.textContent = 'Play a note';
    if (meterWrap) meterWrap.removeAttribute('data-state');
    smoothedFreq = null;
    smoothedAngle = 0;
  }

  function handleMicFrame(freq) {
    if (freq === -1 || freq < 30 || freq > 2000) {
      micSilenceFrames++;
      if (micSilenceFrames === silenceHoldFrames()) resetMicReadout();
      return;
    }
    micSilenceFrames = 0;

    if (smoothedFreq === null || Math.abs(freq - smoothedFreq) / smoothedFreq > 0.06) {
      smoothedFreq = freq;
    } else {
      smoothedFreq += (freq - smoothedFreq) * freqSmoothingFactor();
    }

    const { noteName, octave, cents } = core.freqToNote(smoothedFreq);
    const noteDisplay = document.getElementById('pitchNoteDisplay');
    const freqValue = document.getElementById('pitchFreqValue');
    const centsDisplay = document.getElementById('pitchCentsDisplay');
    const needle = document.getElementById('pitchNeedle');
    const meterWrap = document.getElementById('pitchMeterWrap');
    if (noteDisplay) noteDisplay.textContent = `${noteName}${octave}`;
    if (freqValue) freqValue.textContent = smoothedFreq.toFixed(1);
    if (centsDisplay) centsDisplay.textContent = `${cents > 0 ? '+' : ''}${cents} cent`;

    const clamped = Math.max(-50, Math.min(50, cents));
    const targetAngle = (clamped / 50) * 80;
    smoothedAngle += (targetAngle - smoothedAngle) * needleSmoothingFactor();
    if (needle) needle.style.transform = `rotate(${smoothedAngle}deg)`;

    let state = 'in';
    if (cents < -6) state = 'flat';
    else if (cents > 6) state = 'sharp';
    else if (cents >= -5 && cents <= 5) state = 'perfect';
    if (meterWrap) meterWrap.dataset.state = state;
  }

  // ==================== Tone Generator：描画 ====================
  function getCurrentStringSet() {
    if (currentPreset === 'chromatic') return CHROMATIC_LIST;
    if (currentPreset === 'ukulele') return buildStringSet('ukulele', 'regular');
    return buildStringSet(currentPreset, currentTuning);
  }

  function renderToneScreen(container) {
    container.innerHTML =
      '<div id="pitchTunerToneScreen">' +
        '<div class="pitch-preset-tabs" id="pitchPresetTabs">' +
          '<button class="pitch-preset-tab is-active" data-preset="guitar" type="button">Guitar</button>' +
          '<button class="pitch-preset-tab" data-preset="bass" type="button">Bass</button>' +
          '<button class="pitch-preset-tab" data-preset="ukulele" type="button">Ukulele</button>' +
          '<button class="pitch-preset-tab" data-preset="chromatic" type="button">Wind (Chromatic)</button>' +
        '</div>' +
        '<div class="pitch-tuning-tabs" id="pitchTuningTabs"></div>' +
        '<div class="pitch-string-list-card">' +
          '<div class="pitch-string-list" id="pitchStringList"></div>' +
        '</div>' +
      '</div>';

    document.getElementById('pitchPresetTabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.pitch-preset-tab');
      if (!tab) return;
      selectPreset(tab.dataset.preset);
    });
    document.getElementById('pitchTuningTabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.pitch-tuning-tab');
      if (!tab) return;
      selectTuning(tab.dataset.tuning);
    });

    renderTuningTabs();
    renderStringList();
  }

  function renderTuningTabs() {
    const tuningTabs = document.getElementById('pitchTuningTabs');
    if (!tuningTabs) return;
    const variants = TUNING_VARIANTS[currentPreset];
    if (!variants) {
      tuningTabs.hidden = true;
      tuningTabs.innerHTML = '';
      return;
    }
    tuningTabs.hidden = false;
    tuningTabs.innerHTML = '';
    variants.forEach(v => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pitch-tuning-tab' + (v.key === currentTuning ? ' is-active' : '');
      btn.textContent = v.label;
      btn.dataset.tuning = v.key;
      tuningTabs.appendChild(btn);
    });
  }

  function renderStringList() {
    const stringList = document.getElementById('pitchStringList');
    if (!stringList) return;
    stringList.innerHTML = '';
    const items = getCurrentStringSet();
    items.forEach((item, index) => {
      const freq = core.noteToFreq(item.midi);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pitch-string-row';
      row.innerHTML =
        '<span class="pitch-string-row-left">' +
          '<span class="pitch-string-row-order">' + (index + 1) + '</span>' +
          '<span class="pitch-string-row-note">' + item.note + '</span>' +
          '<span class="pitch-string-row-label">' + item.label + '</span>' +
        '</span>' +
        '<span class="pitch-string-row-freq">' + freq.toFixed(1) + ' Hz</span>';
      row.addEventListener('click', () => {
        if (playingRowEl === row) {
          stopTone();
        } else {
          playTone(freq, item.note, row);
        }
      });
      stringList.appendChild(row);
    });
  }

  function selectPreset(presetKey) {
    if (!PRESET_ORDER.includes(presetKey) || presetKey === currentPreset) return;
    document.querySelectorAll('.pitch-preset-tab').forEach(t => {
      t.classList.toggle('is-active', t.dataset.preset === presetKey);
    });
    currentPreset = presetKey;
    currentTuning = 'regular';
    stopTone();
    renderTuningTabs();
    renderStringList();
  }

  function selectTuning(tuningKey) {
    const variants = TUNING_VARIANTS[currentPreset];
    if (!variants || !variants.some(v => v.key === tuningKey) || tuningKey === currentTuning) return;
    document.querySelectorAll('.pitch-tuning-tab').forEach(t => {
      t.classList.toggle('is-active', t.dataset.tuning === tuningKey);
    });
    currentTuning = tuningKey;
    stopTone();
    renderStringList();
  }

  // ==================== メインウインドウ登録 ====================
  function renderMainView(container) {
    container.innerHTML =
      '<div id="pitchTunerSubTabs">' +
        '<button type="button" class="pitch-tuner-subtab' + (subTab === 'mic' ? ' is-active' : '') + '" data-subtab="mic">Mic Tuner</button>' +
        '<button type="button" class="pitch-tuner-subtab' + (subTab === 'tone' ? ' is-active' : '') + '" data-subtab="tone">Tone Generator</button>' +
      '</div>' +
      '<div id="pitchTunerBody"></div>';

    container.querySelectorAll('.pitch-tuner-subtab').forEach(btn => {
      btn.addEventListener('click', () => switchSubTab(btn.dataset.subtab));
    });

    renderSubTabBody();
  }

  function renderSubTabBody() {
    const body = document.getElementById('pitchTunerBody');
    if (!body) return;
    if (subTab === 'mic') {
      renderMicScreen(body);
      if (toneOsc) stopTone();
    } else {
      renderToneScreen(body);
      if (micSession) stopMic();
    }
  }

  function switchSubTab(tab) {
    if (tab === subTab) return;
    subTab = tab;
    document.querySelectorAll('.pitch-tuner-subtab').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.subtab === tab);
    });
    renderSubTabBody();
  }

  function renderBottomBar(container) {
    container.innerHTML =
      '<div class="pitch-tone-now" id="pitchToneNow" hidden>' +
        '<span class="pitch-tone-now-note" id="pitchToneNowNote">—</span>' +
        '<span class="pitch-tone-now-freq"><span id="pitchToneNowFreq">0.0</span> Hz</span>' +
      '</div>' +
      '<button type="button" class="pcv2-ctrl-btn" id="pitchBottomStopBtn" title="Stop">' +
        '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>' +
        '<span>Stop</span>' +
      '</button>';
    document.getElementById('pitchBottomStopBtn').addEventListener('click', () => {
      stopTone();
      stopMic();
    });
  }

  function onModeLeave() {
    stopTone();
    stopMic();
  }

  window.QNPitch.mainView.register('tuner', {
    render: renderMainView,
    onModeLeave
  });

  window.QNPitch.bottomBar.register('tuner', {
    render: renderBottomBar
  });

  // Sensitivityパネル（アイコンバー→パネル）
  window.QNPitch.panels.register('tuner-sensitivity', {
    label: 'Sensitivity',
    icon: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-2h2zm0-4h-2V7h2z"/>',
    modes: ['tuner'],
    render(panelBody) {
      panelBody.innerHTML =
        '<div class="pitch-sensitivity-control">' +
          '<div class="pitch-sensitivity-label"><span>Sensitivity</span><span class="pitch-sensitivity-value" id="pitchSensitivityValue">' + micSensitivity + '%</span></div>' +
          '<input type="range" id="pitchSensitivitySlider" class="pitch-sensitivity-slider" min="0" max="100" step="1" value="' + micSensitivity + '">' +
          '<div class="pitch-sensitivity-label"><span>Smoothing</span><span class="pitch-sensitivity-value" id="pitchSmoothingValue">' + micSmoothing + '%</span></div>' +
          '<input type="range" id="pitchSmoothingSlider" class="pitch-sensitivity-slider" min="0" max="100" step="1" value="' + micSmoothing + '">' +
        '</div>';
      document.getElementById('pitchSensitivitySlider').addEventListener('input', (e) => {
        micSensitivity = parseInt(e.target.value, 10);
        document.getElementById('pitchSensitivityValue').textContent = micSensitivity + '%';
        saveMicSettings();
      });
      document.getElementById('pitchSmoothingSlider').addEventListener('input', (e) => {
        micSmoothing = parseInt(e.target.value, 10);
        document.getElementById('pitchSmoothingValue').textContent = micSmoothing + '%';
        saveMicSettings();
      });
    }
  });
})();
