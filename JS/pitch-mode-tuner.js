// ============================================================
// pitch-mode-tuner.js
// TUNERMODE：Mic Tuner（メイン画面）・Tone Generator（サイドバー
// パネル、Toneタブ）・Sensitivity（サイドバーパネル、Markersタブ）。
//
// 【方針】index.html側に静的HTMLとして既に用意された要素
// （#pitchTunerDisplayMount、#pitchPresetTabs、#pitchStringList、
// #pitchSensitivitySlider等）を、QNPLAYERのplayer-controls.js等と
// 同じ「DOM操作で値を反映する」方式で制御する（JS側でinnerHTML生成
// する箇所は、複数パターンから選べるメイン表示（Gauge/Guitar Meter）
// と、プリセットにより中身が変わる弦リストのみ）。
//
// ピッチ検出（autoCorrelate）・音名変換は重複させず、pitch-core.js
// の共通関数（window.QNPitch.core）を使う。
// ============================================================

window.QNPitch = window.QNPitch || {};

(function () {
  const core = window.QNPitch.core;

  // ==================== プリセット定義（旧QNTUNERから移植） ====================
  const BASE_STRINGS = {
    guitar: [
      { label: 'String 1', midi: 76 },
      { label: 'String 2', midi: 71 },
      { label: 'String 3', midi: 67 },
      { label: 'String 4', midi: 62 },
      { label: 'String 5', midi: 57 },
      { label: 'String 6', midi: 52 },
    ],
    bass: [
      { label: 'String 1', midi: 55 },
      { label: 'String 2', midi: 50 },
      { label: 'String 3', midi: 45 },
      { label: 'String 4', midi: 40 },
    ],
    ukulele: [
      { label: 'String 1', midi: 69 },
      { label: 'String 2', midi: 64 },
      { label: 'String 3', midi: 60 },
      { label: 'String 4', midi: 67 },
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

  // ==================== メイン表示パターンのレジストリ ====================
  const displayStyles = {};
  function registerDisplayStyle(id, def) {
    displayStyles[id] = def;
  }

  const DISPLAY_STYLE_KEY = 'qnpitch_tuner_display_style_v1';
  function loadDisplayStyle() {
    try {
      const v = localStorage.getItem(DISPLAY_STYLE_KEY);
      return v || 'gauge';
    } catch (e) { return 'gauge'; }
  }
  function saveDisplayStyle(id) {
    try { localStorage.setItem(DISPLAY_STYLE_KEY, id); } catch (e) { /* ignore */ }
  }
  let currentDisplayStyle = loadDisplayStyle();

  // ---------- 表示パターン1：ゲージ式 ----------
  // 【v1.0.1】ユーザー要望によりゲージを大型化し、目盛り本数を
  // 増やした（-50〜+50セントを10セント刻みで11本の目盛り線を表示、
  // 中央0セント付近の3本を太く強調）。SVG座標系自体を200x200
  // （旧300x170）に変更し、中央寄せの正方形に近いレイアウトにした。
  const GAUGE_TICKS = [];
  for (let c = -50; c <= 50; c += 10) GAUGE_TICKS.push(c);
  function buildGaugeTicksSvg() {
    const cx = 150, cy = 150, rOuter = 130, rInnerMajor = 108, rInnerMinor = 116;
    return GAUGE_TICKS.map(cents => {
      const angleDeg = (cents / 50) * 90 - 90; // -90(左端=-50¢) 〜 +90(右端=+50¢)、0¢で真上
      const angleRad = (angleDeg * Math.PI) / 180;
      const isMajor = cents % 20 === 0; // 0, ±20, ±40 を太い目盛りにする
      const rInner = isMajor ? rInnerMajor : rInnerMinor;
      const x1 = cx + rOuter * Math.cos(angleRad);
      const y1 = cy + rOuter * Math.sin(angleRad);
      const x2 = cx + rInner * Math.cos(angleRad);
      const y2 = cy + rInner * Math.sin(angleRad);
      const cls = cents === 0 ? 'pitch-gauge-tick pitch-gauge-tick-zero' : (isMajor ? 'pitch-gauge-tick pitch-gauge-tick-major' : 'pitch-gauge-tick pitch-gauge-tick-minor');
      return '<line class="' + cls + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" />';
    }).join('');
  }

  registerDisplayStyle('gauge', {
    label: 'Gauge',
    render(container) {
      container.innerHTML =
        '<div class="pitch-meter-wrap" id="pitchMeterWrap">' +
          '<div class="pitch-gauge">' +
            '<svg class="pitch-gauge-svg" viewBox="0 0 300 165" aria-hidden="true">' +
              '<path class="pitch-gauge-track" d="M 20 150 A 130 130 0 0 1 280 150" />' +
              '<path class="pitch-gauge-zone-flat" d="M 20 150 A 130 130 0 0 1 95 35" />' +
              '<path class="pitch-gauge-zone-in" d="M 108 23 A 130 130 0 0 1 192 23" />' +
              '<path class="pitch-gauge-zone-sharp" d="M 205 35 A 130 130 0 0 1 280 150" />' +
              buildGaugeTicksSvg() +
              '<g id="pitchNeedle" class="pitch-needle" style="transform: rotate(0deg)">' +
                '<line x1="150" y1="150" x2="150" y2="35" />' +
                '<circle cx="150" cy="150" r="8" />' +
              '</g>' +
            '</svg>' +
            '<div class="pitch-gauge-labels"><span>♭</span><span>IN TUNE</span><span>♯</span></div>' +
          '</div>' +
          '<div class="pitch-reading">' +
            '<div class="pitch-note-display" id="pitchNoteDisplay">—</div>' +
            '<div class="pitch-freq-display"><span id="pitchFreqValue">0.0</span> Hz</div>' +
            '<div class="pitch-cents-display" id="pitchCentsDisplay">Play a note</div>' +
          '</div>' +
        '</div>';
    },
    update(reading) {
      const noteDisplay = document.getElementById('pitchNoteDisplay');
      const freqValue = document.getElementById('pitchFreqValue');
      const centsDisplay = document.getElementById('pitchCentsDisplay');
      const needle = document.getElementById('pitchNeedle');
      const meterWrap = document.getElementById('pitchMeterWrap');
      if (!reading.hasSignal) {
        if (needle) needle.style.transform = 'rotate(0deg)';
        if (noteDisplay) noteDisplay.textContent = '—';
        if (freqValue) freqValue.textContent = '0.0';
        if (centsDisplay) centsDisplay.textContent = 'Play a note';
        if (meterWrap) meterWrap.removeAttribute('data-state');
        return;
      }
      if (noteDisplay) noteDisplay.textContent = `${reading.noteName}${reading.octave}`;
      if (freqValue) freqValue.textContent = reading.freq.toFixed(1);
      if (centsDisplay) centsDisplay.textContent = `${reading.cents > 0 ? '+' : ''}${reading.cents} cent`;

      const clamped = Math.max(-50, Math.min(50, reading.cents));
      const targetAngle = (clamped / 50) * 80;
      if (needle) needle.style.transform = `rotate(${targetAngle}deg)`;

      let state = 'in';
      if (reading.cents < -6) state = 'flat';
      else if (reading.cents > 6) state = 'sharp';
      else if (reading.cents >= -5 && reading.cents <= 5) state = 'perfect';
      if (meterWrap) meterWrap.dataset.state = state;
    },
    reset() {
      const noteDisplay = document.getElementById('pitchNoteDisplay');
      const freqValue = document.getElementById('pitchFreqValue');
      const centsDisplay = document.getElementById('pitchCentsDisplay');
      const needle = document.getElementById('pitchNeedle');
      const meterWrap = document.getElementById('pitchMeterWrap');
      if (needle) needle.style.transform = 'rotate(0deg)';
      if (noteDisplay) noteDisplay.textContent = '—';
      if (freqValue) freqValue.textContent = '0.0';
      if (centsDisplay) centsDisplay.textContent = 'Play a note';
      if (meterWrap) meterWrap.removeAttribute('data-state');
    }
  });

  // ---------- 表示パターン2：ギターチューナー式 ----------
  const GUITAR_STEP_CENTS = 10;
  const GUITAR_STEPS = 5;
  registerDisplayStyle('guitar-meter', {
    label: 'Guitar Meter',
    render(container) {
      let dots = '';
      for (let i = -GUITAR_STEPS; i <= GUITAR_STEPS; i++) {
        const isCenter = i === 0;
        dots += '<div class="pitch-gm-dot' + (isCenter ? ' pitch-gm-dot-center' : '') + '" data-step="' + i + '"></div>';
      }
      container.innerHTML =
        '<div class="pitch-gm-wrap" id="pitchGmWrap">' +
          '<div class="pitch-gm-note-display" id="pitchGmNoteDisplay">—</div>' +
          '<div class="pitch-gm-meter" id="pitchGmMeter">' + dots + '</div>' +
          '<div class="pitch-gm-labels"><span>♭</span><span>IN TUNE</span><span>♯</span></div>' +
          '<div class="pitch-gm-freq" id="pitchGmFreq">0.0 Hz</div>' +
        '</div>';
    },
    update(reading) {
      const wrap = document.getElementById('pitchGmWrap');
      const noteDisplay = document.getElementById('pitchGmNoteDisplay');
      const freqEl = document.getElementById('pitchGmFreq');
      const meter = document.getElementById('pitchGmMeter');
      if (!wrap || !meter) return;

      if (!reading.hasSignal) {
        noteDisplay.textContent = '—';
        freqEl.textContent = '0.0 Hz';
        wrap.removeAttribute('data-state');
        meter.querySelectorAll('.pitch-gm-dot').forEach(d => d.classList.remove('active'));
        return;
      }

      noteDisplay.textContent = `${reading.noteName}${reading.octave}`;
      freqEl.textContent = reading.freq.toFixed(1) + ' Hz';

      const clamped = Math.max(-50, Math.min(50, reading.cents));
      const step = Math.round(clamped / GUITAR_STEP_CENTS);

      meter.querySelectorAll('.pitch-gm-dot').forEach(d => {
        const dStep = parseInt(d.dataset.step, 10);
        const lit = step === 0 ? dStep === 0 : (step > 0 ? (dStep > 0 && dStep <= step) : (dStep < 0 && dStep >= step));
        d.classList.toggle('active', lit || dStep === 0);
      });

      let state = 'in';
      if (reading.cents < -6) state = 'flat';
      else if (reading.cents > 6) state = 'sharp';
      else if (reading.cents >= -5 && reading.cents <= 5) state = 'perfect';
      wrap.dataset.state = state;
    },
    reset() {
      const wrap = document.getElementById('pitchGmWrap');
      const noteDisplay = document.getElementById('pitchGmNoteDisplay');
      const freqEl = document.getElementById('pitchGmFreq');
      const meter = document.getElementById('pitchGmMeter');
      if (wrap) wrap.removeAttribute('data-state');
      if (noteDisplay) noteDisplay.textContent = '—';
      if (freqEl) freqEl.textContent = '0.0 Hz';
      if (meter) meter.querySelectorAll('.pitch-gm-dot').forEach(d => d.classList.remove('active'));
    }
  });

  // ==================== 状態 ====================
  let micSession = null;
  let micRunning = false;
  let micSensitivity = 100;
  let micSmoothing = 100;
  let micSilenceFrames = 0;
  let smoothedFreq = null;

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

  function silenceHoldFrames() {
    return Math.round(6 + (100 - micSensitivity) / 100 * 24);
  }
  function freqSmoothingFactor() {
    return 0.1 + (micSmoothing / 100) * 0.5;
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

  // ==================== Mic Tuner：メイン画面 ====================
  function renderMainDisplay() {
    const mount = document.getElementById('pitchTunerDisplayMount');
    if (!mount) return;
    const style = displayStyles[currentDisplayStyle] || displayStyles.gauge;
    style.render(mount);
    mount.hidden = !micRunning;
    const permEl = document.getElementById('pitchMicPermission');
    if (permEl) permEl.hidden = micRunning;
  }

  async function startMic() {
    if (micRunning) return;
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
      if (errorNote) errorNote.textContent = 'マイクへのアクセスが許可されませんでした';
      micSession = null;
      return;
    }

    micRunning = true;
    renderMainDisplay();
    updateHeaderMicBtn();
  }

  function stopMic() {
    if (micSession) {
      micSession.stop();
      micSession = null;
    }
    micRunning = false;
    resetMicReadout();
    renderMainDisplay();
    updateHeaderMicBtn();
  }

  function updateHeaderMicBtn() {
    const btn = document.getElementById('pitchHeaderMicBtn');
    if (btn) btn.classList.toggle('mic-on', micRunning);
  }

  function resetMicReadout() {
    const style = displayStyles[currentDisplayStyle] || displayStyles.gauge;
    if (typeof style.reset === 'function') style.reset();
    smoothedFreq = null;
  }

  function handleMicFrame(freq) {
    const style = displayStyles[currentDisplayStyle] || displayStyles.gauge;
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
    style.update({ hasSignal: true, noteName, octave, cents, freq: smoothedFreq });
  }

  // ==================== Tone Generator：パネル ====================
  let currentPreset = 'guitar';
  let currentTuning = 'regular';

  function getCurrentStringSet() {
    if (currentPreset === 'chromatic') return CHROMATIC_LIST;
    if (currentPreset === 'ukulele') return buildStringSet('ukulele', 'regular');
    return buildStringSet(currentPreset, currentTuning);
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

  function initTonePanel() {
    const presetTabs = document.getElementById('pitchPresetTabs');
    if (presetTabs && !presetTabs.dataset.bound) {
      presetTabs.dataset.bound = '1';
      presetTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.pitch-preset-tab');
        if (!tab) return;
        selectPreset(tab.dataset.preset);
      });
    }
    const tuningTabs = document.getElementById('pitchTuningTabs');
    if (tuningTabs && !tuningTabs.dataset.bound) {
      tuningTabs.dataset.bound = '1';
      tuningTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.pitch-tuning-tab');
        if (!tab) return;
        selectTuning(tab.dataset.tuning);
      });
    }
    const stopBtn = document.getElementById('pitchToneStopBtn');
    if (stopBtn && !stopBtn.dataset.bound) {
      stopBtn.dataset.bound = '1';
      stopBtn.addEventListener('click', stopTone);
    }
    renderTuningTabs();
    renderStringList();
  }

  // ==================== Sensitivity/Display設定パネル ====================
  // ==================== Displayパネル（メイン表示選択、プレビュー付き） ====================
  // 【v1.0.2新設】Sensitivityパネルから分離した専用パネル。プルダウンは
  // 見た目が想像しにくいため、各表示パターンの簡易プレビュー（ミニ
  // ゲージ／ミニGuitar Meter）付きの選択カードを縦に2段並べる方式にした。
  function initDisplayPanel() {
    const container = document.getElementById('pitchDisplayChoices');
    if (!container) return;

    container.innerHTML =
      '<button type="button" class="pitch-display-choice" data-style="gauge">' +
        '<div class="pitch-display-choice-preview">' +
          '<svg viewBox="0 0 120 66" aria-hidden="true">' +
            '<path class="pdc-track" d="M 8 60 A 52 52 0 0 1 112 60" />' +
            '<path class="pdc-zone-in" d="M 43 12 A 52 52 0 0 1 77 12" />' +
            '<line class="pdc-needle" x1="60" y1="60" x2="60" y2="16" />' +
            '<circle class="pdc-needle-hub" cx="60" cy="60" r="4" />' +
          '</svg>' +
        '</div>' +
        '<div class="pitch-display-choice-label">' +
          '<span class="pitch-display-choice-title">Gauge</span>' +
          '<span class="pitch-display-choice-desc">半円メーターの針で音程のズレを表示</span>' +
        '</div>' +
        '<div class="pitch-display-choice-check"></div>' +
      '</button>' +
      '<button type="button" class="pitch-display-choice" data-style="guitar-meter">' +
        '<div class="pitch-display-choice-preview">' +
          '<svg viewBox="0 0 120 40" aria-hidden="true">' +
            (() => {
              let dots = '';
              for (let i = -5; i <= 5; i++) {
                const x = 60 + i * 9;
                const h = i === 0 ? 26 : (i % 2 === 0 ? 18 : 12);
                const cls = i === 0 ? 'pdc-gm-dot pdc-gm-dot-center' : 'pdc-gm-dot';
                dots += '<rect class="' + cls + '" x="' + (x - 2) + '" y="' + (36 - h) + '" width="4" height="' + h + '" rx="2" />';
              }
              return dots;
            })() +
          '</svg>' +
        '</div>' +
        '<div class="pitch-display-choice-label">' +
          '<span class="pitch-display-choice-title">Guitar Meter</span>' +
          '<span class="pitch-display-choice-desc">左右のメモリでセント単位のズレを表示</span>' +
        '</div>' +
        '<div class="pitch-display-choice-check"></div>' +
      '</button>';

    function syncActiveState() {
      container.querySelectorAll('.pitch-display-choice').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.style === currentDisplayStyle);
      });
    }
    syncActiveState();

    container.querySelectorAll('.pitch-display-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        const styleId = btn.dataset.style;
        if (styleId === currentDisplayStyle) return;
        currentDisplayStyle = styleId;
        saveDisplayStyle(currentDisplayStyle);
        syncActiveState();
        renderMainDisplay();
        if (micRunning) resetMicReadout();
      });
    });
  }

  // ==================== Sensitivityパネル ====================
  function initSettingsPanel() {
    const sensSlider = document.getElementById('pitchSensitivitySlider');
    const sensValue = document.getElementById('pitchSensitivityValue');
    if (sensSlider) {
      sensSlider.value = micSensitivity;
      if (sensValue) sensValue.textContent = micSensitivity;
      if (!sensSlider.dataset.bound) {
        sensSlider.dataset.bound = '1';
        sensSlider.addEventListener('input', (e) => {
          micSensitivity = parseInt(e.target.value, 10);
          if (sensValue) sensValue.textContent = micSensitivity;
          saveMicSettings();
        });
      }
    }

    const smoothSlider = document.getElementById('pitchSmoothingSlider');
    const smoothValue = document.getElementById('pitchSmoothingValue');
    if (smoothSlider) {
      smoothSlider.value = micSmoothing;
      if (smoothValue) smoothValue.textContent = micSmoothing;
      if (!smoothSlider.dataset.bound) {
        smoothSlider.dataset.bound = '1';
        smoothSlider.addEventListener('input', (e) => {
          micSmoothing = parseInt(e.target.value, 10);
          if (smoothValue) smoothValue.textContent = micSmoothing;
          saveMicSettings();
        });
      }
    }
  }

  // ==================== 初期化 ====================
  function init() {
    renderMainDisplay();
    initTonePanel();
    initSettingsPanel();
    initDisplayPanel();
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }

  function onModeLeave() {
    stopTone();
    if (micRunning) stopMic();
  }

  window.addEventListener('qnpitch-mode-change', (e) => {
    if (e.detail && e.detail.from === 'tuner') onModeLeave();
  });

  // ヘッダーのマイクON/OFFボタンから呼べるよう公開する。
  window.QNPitch.tunerMode = {
    startMic,
    stopMic,
    isMicRunning: () => micRunning
  };
})();
