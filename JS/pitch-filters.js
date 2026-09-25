// ============================================================
// pitch-filters.js
// ノイズ除去フィルタ・音程ズレハイライト・ビブラート検出・スコア判定。
// PITCHMODEの録音済みトラック（pitchTrack）に対する事後処理一式。
//
// 【移植元】旧QNPITCH(app.js)の applyFilters / detectSustainedRegions /
// isVibrato / detectDriftRegions / detectVibratoRegions / calcScore を
// そのまま移植。設定パネルのHTMLは、QNPLAYERの.control-card型
// （style-core.cssから完全コピー）を使って構築する。
// ============================================================

window.QNPitch = window.QNPitch || {};

(function () {
  const FILTER_DEFAULTS = {
    jumpWindowMs: 150,
    jumpSemitones: 2,
    spikeRemoval: true,
    rmsThreshold: 0,
    pitchDriftEnabled: false,
    pitchDriftDurationMs: 400,
    pitchDriftCents: 20,
    vibratoEnabled: true,
    vibratoMinRateHz: 3,
    vibratoMaxRateHz: 8,
    vibratoMinCents: 15,
    scoreCentsThreshold: 25
  };
  const FILTER_STORAGE_KEY = 'qnpitch_filter_settings_v1';

  let filterSettings = loadFilterSettings();

  function loadFilterSettings() {
    try {
      const raw = localStorage.getItem(FILTER_STORAGE_KEY);
      if (!raw) return Object.assign({}, FILTER_DEFAULTS);
      const parsed = JSON.parse(raw);
      const merged = Object.assign({}, FILTER_DEFAULTS, parsed);
      merged.rmsThreshold = Math.max(0, Math.min(0.5, merged.rmsThreshold));
      return merged;
    } catch (e) {
      return Object.assign({}, FILTER_DEFAULTS);
    }
  }

  function saveFilterSettings() {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filterSettings));
    } catch (e) { /* ignore */ }
  }

  function applyFilters(track) {
    if (!track.length) return track;

    const rmsThreshold = filterSettings.rmsThreshold;
    let filtered = track.map(function (p) {
      if (p.voiced && rmsThreshold > 0 && (p.rms === undefined || p.rms < rmsThreshold)) {
        return Object.assign({}, p, { voiced: false });
      }
      return p;
    });

    const windowSec = filterSettings.jumpWindowMs / 1000;
    if (filterSettings.jumpSemitones > 0 && windowSec > 0) {
      filtered = filtered.map(function (p, i) {
        if (!p.voiced) return p;
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
          if (dPrev > 1.5 && dNext > 1.5 && dPrevNext < 1.0) {
            return Object.assign({}, p, { voiced: false });
          }
        }
        return p;
      });
    }

    return filtered;
  }

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

  function isVibrato(track, startIdx, endIdx) {
    const pts = [];
    for (let k = startIdx; k <= endIdx; k++) {
      if (track[k].voiced) pts.push(track[k]);
    }
    if (pts.length < 6) return false;

    const crossings = [];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1].cents, b = pts[k].cents;
      if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) crossings.push(pts[k].t);
    }
    if (crossings.length < 3) return false;

    const halfPeriods = [];
    for (let k = 1; k < crossings.length; k++) halfPeriods.push(crossings[k] - crossings[k - 1]);
    const avgHalfPeriod = halfPeriods.reduce(function (a, b) { return a + b; }, 0) / halfPeriods.length;
    if (avgHalfPeriod <= 0) return false;
    const rateHz = 1 / (avgHalfPeriod * 2);

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
      if (filterSettings.vibratoEnabled && isVibrato(track, r.startIdx, r.endIdx)) return;
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

  function calcScore(track) {
    const minDurationSec = filterSettings.pitchDriftDurationMs / 1000;
    const sustained = detectSustainedRegions(track, minDurationSec);
    const scoredRegions = filterSettings.vibratoEnabled
      ? sustained.filter(function (r) { return !isVibrato(track, r.startIdx, r.endIdx); })
      : sustained;
    if (!scoredRegions.length) return null;

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

  // ==================== 設定パネル ====================
  function renderFilterPanel() {
    const box = document.getElementById('pitchFiltersBox');
    if (!box) return;

    box.innerHTML =
      '<div class="control-list">' +
        '<div class="control-card">' +
          '<label>急変スキップ：時間窓 <span id="pitchJumpWindowValue" style="color:#fff;">' + filterSettings.jumpWindowMs + '</span> ms</label>' +
          '<input type="range" id="pitchJumpWindowInput" min="0" max="500" step="10" value="' + filterSettings.jumpWindowMs + '">' +
        '</div>' +
        '<div class="control-card">' +
          '<label>急変スキップ：音程変化量 <span id="pitchJumpSemitonesValue" style="color:#fff;">' + filterSettings.jumpSemitones + '</span> 半音</label>' +
          '<input type="range" id="pitchJumpSemitonesInput" min="0" max="12" step="1" value="' + filterSettings.jumpSemitones + '">' +
        '</div>' +
        '<div class="control-card">' +
          '<label>' +
            'スパイク除去' +
            '<button class="glow-switch control-effect-toggle" id="pitchSpikeToggle" role="switch" aria-checked="' + filterSettings.spikeRemoval + '"><span class="glow-switch-knob"></span></button>' +
          '</label>' +
        '</div>' +
        '<div class="control-card">' +
          '<label>音量ゲート：最低音量 <span id="pitchRmsThresholdValue" style="color:#fff;">' + filterSettings.rmsThreshold.toFixed(2) + '</span></label>' +
          '<input type="range" id="pitchRmsThresholdInput" min="0" max="0.5" step="0.01" value="' + filterSettings.rmsThreshold + '">' +
        '</div>' +
        '<div class="control-card">' +
          '<label>' +
            '音程ズレハイライト' +
            '<button class="glow-switch control-effect-toggle" id="pitchDriftToggle" role="switch" aria-checked="' + filterSettings.pitchDriftEnabled + '"><span class="glow-switch-knob"></span></button>' +
          '</label>' +
          '<div style="margin-top:10px;">' +
            '<label style="font-size:var(--fs-small);color:var(--icon-muted);">最低保持期間 <span id="pitchDriftDurationValue" style="color:#fff;">' + filterSettings.pitchDriftDurationMs + '</span> ms</label>' +
            '<input type="range" id="pitchDriftDurationInput" min="100" max="2000" step="50" value="' + filterSettings.pitchDriftDurationMs + '">' +
          '</div>' +
          '<div style="margin-top:10px;">' +
            '<label style="font-size:var(--fs-small);color:var(--icon-muted);">平均ズレ閾値 <span id="pitchDriftCentsValue" style="color:#fff;">' + filterSettings.pitchDriftCents + '</span> ¢</label>' +
            '<input type="range" id="pitchDriftCentsInput" min="1" max="50" step="1" value="' + filterSettings.pitchDriftCents + '">' +
          '</div>' +
        '</div>' +
        '<div class="control-card">' +
          '<label>' +
            'ビブラート検出' +
            '<button class="glow-switch control-effect-toggle" id="pitchVibratoToggle" role="switch" aria-checked="' + filterSettings.vibratoEnabled + '"><span class="glow-switch-knob"></span></button>' +
          '</label>' +
          '<div style="margin-top:10px;">' +
            '<label style="font-size:var(--fs-small);color:var(--icon-muted);">揺れ周期（下限） <span id="pitchVibMinRateValue" style="color:#fff;">' + filterSettings.vibratoMinRateHz.toFixed(1) + '</span> Hz</label>' +
            '<input type="range" id="pitchVibMinRateInput" min="1" max="10" step="0.5" value="' + filterSettings.vibratoMinRateHz + '">' +
          '</div>' +
          '<div style="margin-top:10px;">' +
            '<label style="font-size:var(--fs-small);color:var(--icon-muted);">揺れ周期（上限） <span id="pitchVibMaxRateValue" style="color:#fff;">' + filterSettings.vibratoMaxRateHz.toFixed(1) + '</span> Hz</label>' +
            '<input type="range" id="pitchVibMaxRateInput" min="1" max="12" step="0.5" value="' + filterSettings.vibratoMaxRateHz + '">' +
          '</div>' +
          '<div style="margin-top:10px;">' +
            '<label style="font-size:var(--fs-small);color:var(--icon-muted);">最低揺れ幅 <span id="pitchVibMinCentsValue" style="color:#fff;">' + filterSettings.vibratoMinCents + '</span> ¢</label>' +
            '<input type="range" id="pitchVibMinCentsInput" min="5" max="50" step="1" value="' + filterSettings.vibratoMinCents + '">' +
          '</div>' +
        '</div>' +
        '<div class="control-card">' +
          '<label>スコア判定：許容ズレ閾値 <span id="pitchScoreCentsValue" style="color:#fff;">' + filterSettings.scoreCentsThreshold + '</span> ¢' +
            '<button class="mini-reset-btn" id="pitchFilterResetBtn" title="Reset all filters" style="margin-left:auto;">RESET</button>' +
          '</label>' +
          '<input type="range" id="pitchScoreCentsInput" min="1" max="50" step="1" value="' + filterSettings.scoreCentsThreshold + '">' +
        '</div>' +
      '</div>';

    function onChange(id, fn) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', fn);
    }
    function onToggle(id, key) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', () => {
        filterSettings[key] = !filterSettings[key];
        el.setAttribute('aria-checked', String(filterSettings[key]));
        saveFilterSettings();
        redrawIfNeeded();
      });
    }
    function redrawIfNeeded() {
      if (window.QNPitch.pitchMode && typeof window.QNPitch.pitchMode.redraw === 'function') {
        window.QNPitch.pitchMode.redraw();
      }
    }

    onChange('pitchJumpWindowInput', (e) => {
      filterSettings.jumpWindowMs = parseInt(e.target.value, 10);
      document.getElementById('pitchJumpWindowValue').textContent = filterSettings.jumpWindowMs;
      saveFilterSettings();
      redrawIfNeeded();
    });
    onChange('pitchJumpSemitonesInput', (e) => {
      filterSettings.jumpSemitones = parseInt(e.target.value, 10);
      document.getElementById('pitchJumpSemitonesValue').textContent = filterSettings.jumpSemitones;
      saveFilterSettings();
      redrawIfNeeded();
    });
    onToggle('pitchSpikeToggle', 'spikeRemoval');
    onChange('pitchRmsThresholdInput', (e) => {
      filterSettings.rmsThreshold = parseFloat(e.target.value);
      document.getElementById('pitchRmsThresholdValue').textContent = filterSettings.rmsThreshold.toFixed(2);
      saveFilterSettings();
      redrawIfNeeded();
    });
    onToggle('pitchDriftToggle', 'pitchDriftEnabled');
    onChange('pitchDriftDurationInput', (e) => {
      filterSettings.pitchDriftDurationMs = parseInt(e.target.value, 10);
      document.getElementById('pitchDriftDurationValue').textContent = filterSettings.pitchDriftDurationMs;
      saveFilterSettings();
      redrawIfNeeded();
    });
    onChange('pitchDriftCentsInput', (e) => {
      filterSettings.pitchDriftCents = parseInt(e.target.value, 10);
      document.getElementById('pitchDriftCentsValue').textContent = filterSettings.pitchDriftCents;
      saveFilterSettings();
      redrawIfNeeded();
    });
    onToggle('pitchVibratoToggle', 'vibratoEnabled');
    onChange('pitchVibMinRateInput', (e) => {
      filterSettings.vibratoMinRateHz = parseFloat(e.target.value);
      document.getElementById('pitchVibMinRateValue').textContent = filterSettings.vibratoMinRateHz.toFixed(1);
      saveFilterSettings();
      redrawIfNeeded();
    });
    onChange('pitchVibMaxRateInput', (e) => {
      filterSettings.vibratoMaxRateHz = parseFloat(e.target.value);
      document.getElementById('pitchVibMaxRateValue').textContent = filterSettings.vibratoMaxRateHz.toFixed(1);
      saveFilterSettings();
      redrawIfNeeded();
    });
    onChange('pitchVibMinCentsInput', (e) => {
      filterSettings.vibratoMinCents = parseInt(e.target.value, 10);
      document.getElementById('pitchVibMinCentsValue').textContent = filterSettings.vibratoMinCents;
      saveFilterSettings();
      redrawIfNeeded();
    });
    onChange('pitchScoreCentsInput', (e) => {
      filterSettings.scoreCentsThreshold = parseInt(e.target.value, 10);
      document.getElementById('pitchScoreCentsValue').textContent = filterSettings.scoreCentsThreshold;
      saveFilterSettings();
      redrawIfNeeded();
    });

    const resetBtn = document.getElementById('pitchFilterResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        filterSettings = Object.assign({}, FILTER_DEFAULTS);
        saveFilterSettings();
        renderFilterPanel();
        redrawIfNeeded();
      });
    }
  }

  function init() {
    renderFilterPanel();
  }
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }

  window.QNPitch.filters = {
    get settings() { return filterSettings; },
    applyFilters,
    detectSustainedRegions,
    detectDriftRegions,
    detectVibratoRegions,
    calcScore
  };
})();
