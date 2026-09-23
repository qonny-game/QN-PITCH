// ============================================================
// pitch-filters.js
// ノイズ除去フィルタ・音程ズレハイライト・ビブラート検出・スコア判定。
// PITCHMODEの録音済みトラック（pitchTrack）に対する事後処理一式。
//
// 【移植元】旧QNPITCH(app.js)の applyFilters / detectSustainedRegions /
// isVibrato / detectDriftRegions / detectVibratoRegions / calcScore を
// そのまま移植。設定値の読み書き（localStorage）もここに集約する。
//
// pitch-mode-pitch.js から window.QNPitch.filters として参照される。
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

  // 設定に基づいてtrackをフィルタリングした「描画用」配列を作る。
  // 元のtrack自体は変更しない。
  function applyFilters(track) {
    if (!track.length) return track;

    // 1. 音量ゲート
    const rmsThreshold = filterSettings.rmsThreshold;
    let filtered = track.map(function (p) {
      if (p.voiced && rmsThreshold > 0 && (p.rms === undefined || p.rms < rmsThreshold)) {
        return Object.assign({}, p, { voiced: false });
      }
      return p;
    });

    // 2. 急変スキップ
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

    // 3. スパイク除去
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

  // 「同じノート(半音)を最低保持期間以上維持している区間」を検出する共通関数。
  // ズレハイライト・ビブラート判定・スコア計算の全てがこれを土台にする。
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

  // スコア計算：維持区間のうち、ビブラートを除いて平均ズレが閾値以内の割合(%)
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

  // ==================== 設定パネル（アイコンバー→パネル） ====================
  function renderFilterPanel(panelBody) {
    panelBody.innerHTML =
      '<div class="pitch-filters-panel">' +
        '<div class="pitch-settings-row">' +
          '<div class="pitch-settings-row-label">' +
            '<span class="pitch-settings-row-title">急変スキップ</span>' +
            '<span class="pitch-settings-row-desc">直近の短時間で大きく音程が動いた区間の線を描画しない</span>' +
          '</div>' +
        '</div>' +
        '<div class="pitch-settings-field">' +
          '<label class="pitch-settings-field-label">時間窓 <span class="pitch-settings-field-value" id="pitchJumpWindowValue">' + filterSettings.jumpWindowMs + '</span> ms</label>' +
          '<input type="range" id="pitchJumpWindowInput" class="pitch-settings-slider" min="0" max="500" step="10" value="' + filterSettings.jumpWindowMs + '">' +
        '</div>' +
        '<div class="pitch-settings-field">' +
          '<label class="pitch-settings-field-label">音程変化量 <span class="pitch-settings-field-value" id="pitchJumpSemitonesValue">' + filterSettings.jumpSemitones + '</span> 半音</label>' +
          '<input type="range" id="pitchJumpSemitonesInput" class="pitch-settings-slider" min="0" max="12" step="1" value="' + filterSettings.jumpSemitones + '">' +
        '</div>' +

        '<div class="pitch-settings-divider"></div>' +

        '<div class="pitch-settings-row">' +
          '<div class="pitch-settings-row-label">' +
            '<span class="pitch-settings-row-title">スパイク除去</span>' +
            '<span class="pitch-settings-row-desc">前後と繋がらない孤立した単発の飛び値を除去する</span>' +
          '</div>' +
          '<button type="button" class="pitch-settings-toggle" id="pitchSpikeToggle" role="switch" aria-checked="' + filterSettings.spikeRemoval + '"><span class="pitch-settings-toggle-knob"></span></button>' +
        '</div>' +

        '<div class="pitch-settings-divider"></div>' +

        '<div class="pitch-settings-row">' +
          '<div class="pitch-settings-row-label">' +
            '<span class="pitch-settings-row-title">音量ゲート</span>' +
            '<span class="pitch-settings-row-desc">これより小さい音量で検出されたピッチは無効点として扱う</span>' +
          '</div>' +
        '</div>' +
        '<div class="pitch-settings-field">' +
          '<label class="pitch-settings-field-label">最低音量 <span class="pitch-settings-field-value" id="pitchRmsThresholdValue">' + filterSettings.rmsThreshold.toFixed(2) + '</span> (RMS)</label>' +
          '<input type="range" id="pitchRmsThresholdInput" class="pitch-settings-slider" min="0" max="0.5" step="0.01" value="' + filterSettings.rmsThreshold + '">' +
        '</div>' +

        '<div class="pitch-settings-divider"></div>' +

        '<div class="pitch-settings-row">' +
          '<div class="pitch-settings-row-label">' +
            '<span class="pitch-settings-row-title">音程ズレハイライト</span>' +
            '<span class="pitch-settings-row-desc">同じ音を一定期間以上保持している区間で、平均セントのズレが大きい場合に背景を赤くする</span>' +
          '</div>' +
          '<button type="button" class="pitch-settings-toggle" id="pitchDriftToggle" role="switch" aria-checked="' + filterSettings.pitchDriftEnabled + '"><span class="pitch-settings-toggle-knob"></span></button>' +
        '</div>' +
        '<div class="pitch-settings-field">' +
          '<label class="pitch-settings-field-label">最低保持期間 <span class="pitch-settings-field-value" id="pitchDriftDurationValue">' + filterSettings.pitchDriftDurationMs + '</span> ms</label>' +
          '<input type="range" id="pitchDriftDurationInput" class="pitch-settings-slider" min="100" max="2000" step="50" value="' + filterSettings.pitchDriftDurationMs + '">' +
        '</div>' +
        '<div class="pitch-settings-field">' +
          '<label class="pitch-settings-field-label">平均ズレ閾値 <span class="pitch-settings-field-value" id="pitchDriftCentsValue">' + filterSettings.pitchDriftCents + '</span> ¢</label>' +
          '<input type="range" id="pitchDriftCentsInput" class="pitch-settings-slider" min="1" max="50" step="1" value="' + filterSettings.pitchDriftCents + '">' +
        '</div>' +

        '<div class="pitch-settings-divider"></div>' +

        '<div class="pitch-settings-row">' +
          '<div class="pitch-settings-row-label">' +
            '<span class="pitch-settings-row-title">ビブラート検出</span>' +
            '<span class="pitch-settings-row-desc">規則的に音程が揺れている区間を意図的なビブラートとみなし、ズレハイライトの対象から除外して紫色で表示する</span>' +
          '</div>' +
          '<button type="button" class="pitch-settings-toggle" id="pitchVibratoToggle" role="switch" aria-checked="' + filterSettings.vibratoEnabled + '"><span class="pitch-settings-toggle-knob"></span></button>' +
        '</div>' +
        '<div class="pitch-settings-field">' +
          '<label class="pitch-settings-field-label">揺れ周期（下限） <span class="pitch-settings-field-value" id="pitchVibMinRateValue">' + filterSettings.vibratoMinRateHz.toFixed(1) + '</span> Hz</label>' +
          '<input type="range" id="pitchVibMinRateInput" class="pitch-settings-slider" min="1" max="10" step="0.5" value="' + filterSettings.vibratoMinRateHz + '">' +
        '</div>' +
        '<div class="pitch-settings-field">' +
          '<label class="pitch-settings-field-label">揺れ周期（上限） <span class="pitch-settings-field-value" id="pitchVibMaxRateValue">' + filterSettings.vibratoMaxRateHz.toFixed(1) + '</span> Hz</label>' +
          '<input type="range" id="pitchVibMaxRateInput" class="pitch-settings-slider" min="1" max="12" step="0.5" value="' + filterSettings.vibratoMaxRateHz + '">' +
        '</div>' +
        '<div class="pitch-settings-field">' +
          '<label class="pitch-settings-field-label">最低揺れ幅 <span class="pitch-settings-field-value" id="pitchVibMinCentsValue">' + filterSettings.vibratoMinCents + '</span> ¢</label>' +
          '<input type="range" id="pitchVibMinCentsInput" class="pitch-settings-slider" min="5" max="50" step="1" value="' + filterSettings.vibratoMinCents + '">' +
        '</div>' +

        '<div class="pitch-settings-divider"></div>' +

        '<div class="pitch-settings-row">' +
          '<div class="pitch-settings-row-label">' +
            '<span class="pitch-settings-row-title">スコア判定</span>' +
            '<span class="pitch-settings-row-desc">維持区間の平均ズレがこの範囲以内なら「適正」として録音のスコア(%)に加算する</span>' +
          '</div>' +
        '</div>' +
        '<div class="pitch-settings-field">' +
          '<label class="pitch-settings-field-label">許容ズレ閾値 <span class="pitch-settings-field-value" id="pitchScoreCentsValue">' + filterSettings.scoreCentsThreshold + '</span> ¢</label>' +
          '<input type="range" id="pitchScoreCentsInput" class="pitch-settings-slider" min="1" max="50" step="1" value="' + filterSettings.scoreCentsThreshold + '">' +
        '</div>' +

        '<div class="pitch-settings-btn-row">' +
          '<button type="button" class="pitch-dialog-btn" id="pitchFilterResetBtn">Reset</button>' +
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
        if (typeof window.QNPitch.pitchMode?.redraw === 'function') window.QNPitch.pitchMode.redraw();
      });
    }

    onChange('pitchJumpWindowInput', (e) => {
      filterSettings.jumpWindowMs = parseInt(e.target.value, 10);
      document.getElementById('pitchJumpWindowValue').textContent = filterSettings.jumpWindowMs;
      saveFilterSettings();
      window.QNPitch.pitchMode?.redraw();
    });
    onChange('pitchJumpSemitonesInput', (e) => {
      filterSettings.jumpSemitones = parseInt(e.target.value, 10);
      document.getElementById('pitchJumpSemitonesValue').textContent = filterSettings.jumpSemitones;
      saveFilterSettings();
      window.QNPitch.pitchMode?.redraw();
    });
    onToggle('pitchSpikeToggle', 'spikeRemoval');
    onChange('pitchRmsThresholdInput', (e) => {
      filterSettings.rmsThreshold = parseFloat(e.target.value);
      document.getElementById('pitchRmsThresholdValue').textContent = filterSettings.rmsThreshold.toFixed(2);
      saveFilterSettings();
      window.QNPitch.pitchMode?.redraw();
    });
    onToggle('pitchDriftToggle', 'pitchDriftEnabled');
    onChange('pitchDriftDurationInput', (e) => {
      filterSettings.pitchDriftDurationMs = parseInt(e.target.value, 10);
      document.getElementById('pitchDriftDurationValue').textContent = filterSettings.pitchDriftDurationMs;
      saveFilterSettings();
      window.QNPitch.pitchMode?.redraw();
    });
    onChange('pitchDriftCentsInput', (e) => {
      filterSettings.pitchDriftCents = parseInt(e.target.value, 10);
      document.getElementById('pitchDriftCentsValue').textContent = filterSettings.pitchDriftCents;
      saveFilterSettings();
      window.QNPitch.pitchMode?.redraw();
    });
    onToggle('pitchVibratoToggle', 'vibratoEnabled');
    onChange('pitchVibMinRateInput', (e) => {
      filterSettings.vibratoMinRateHz = parseFloat(e.target.value);
      document.getElementById('pitchVibMinRateValue').textContent = filterSettings.vibratoMinRateHz.toFixed(1);
      saveFilterSettings();
      window.QNPitch.pitchMode?.redraw();
    });
    onChange('pitchVibMaxRateInput', (e) => {
      filterSettings.vibratoMaxRateHz = parseFloat(e.target.value);
      document.getElementById('pitchVibMaxRateValue').textContent = filterSettings.vibratoMaxRateHz.toFixed(1);
      saveFilterSettings();
      window.QNPitch.pitchMode?.redraw();
    });
    onChange('pitchVibMinCentsInput', (e) => {
      filterSettings.vibratoMinCents = parseInt(e.target.value, 10);
      document.getElementById('pitchVibMinCentsValue').textContent = filterSettings.vibratoMinCents;
      saveFilterSettings();
      window.QNPitch.pitchMode?.redraw();
    });
    onChange('pitchScoreCentsInput', (e) => {
      filterSettings.scoreCentsThreshold = parseInt(e.target.value, 10);
      document.getElementById('pitchScoreCentsValue').textContent = filterSettings.scoreCentsThreshold;
      saveFilterSettings();
      window.QNPitch.pitchMode?.redraw();
    });

    document.getElementById('pitchFilterResetBtn').addEventListener('click', () => {
      filterSettings = Object.assign({}, FILTER_DEFAULTS);
      saveFilterSettings();
      renderFilterPanel(panelBody);
      window.QNPitch.pitchMode?.redraw();
    });
  }

  window.QNPitch.filters = {
    get settings() { return filterSettings; },
    applyFilters,
    detectSustainedRegions,
    detectDriftRegions,
    detectVibratoRegions,
    calcScore
  };

  // アイコンバー→パネル登録（PITCHMODEのみ表示）
  window.QNPitch.panels.register('pitch-filters', {
    label: 'Filters',
    icon: '<path d="M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39A.998.998 0 0 0 18.95 4H5.04c-.83 0-1.3.95-.79 1.61z"/>',
    modes: ['pitch'],
    render: renderFilterPanel
  });
})();
