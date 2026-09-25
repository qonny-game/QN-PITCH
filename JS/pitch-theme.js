// ============================================================
// pitch-theme.js
// カラーテーマ切替・Glowアニメーション・Keyboard Shortcuts表生成。
// QNPLAYERのplayer-theme.jsが由来（ハンバーガーボタン開閉ロジックのみ削除。
// PC v2ではColor/Keyboardはアイコンバー下段の専用ボタンから開く）。
// window.QN_THEMES（42色のカラーテーマ配列）を定義・公開。
// window.QN_SHORTCUTS（index.html側で定義、現状未定義）を読んでKeyboard
// Shortcutsテーブルを組み立てる。
// ============================================================
(() => {
  'use strict';

  const THEME_STORAGE_KEY = 'qn_theme';
  const GLOW_STORAGE_KEY = 'qn_glow';

  /* ---------- テーマデータ（唯一のソース） ----------
     カラーテーマを追加・編集する時は、この配列に1件追記/変更するだけでよい。
     hover色・グロー色・スウォッチの見た目・CSSカスタムプロパティ定義は
     すべてここから自動生成される（style-theme.css/index.htmlを手で編集する
     必要はない）。
     表示順もこの配列の並び順のまま使われ、全件を常時展開表示する。
     - name: data-qn-theme属性の値（英数字とハイフンのみ）
     - title: スウォッチのtitle属性（ホバー時のツールチップ）
     - primary: メインカラー(HEX)。単色方針のためsecondaryは
       buildThemeCssAndSwatches()内でprimaryと同じ値に揃えて使う。 */
  const QN_THEMES = [
    // 各色相ごとにLight/Base/Darkの3トーンを用意し、14色相×3=42色にする。
    // secondaryはbuildThemeCssAndSwatches()内でprimaryと同じ値に揃えられる
    // （単色方針）。
    { name: "red-light", title: "Red Light", primary: "#f87171", secondary: "#f87171" },
    { name: "red", title: "Red", primary: "#ef4444", secondary: "#ef4444" },
    { name: "red-dark", title: "Red Dark", primary: "#b91c1c", secondary: "#b91c1c" },

    { name: "orange-light", title: "Orange Light", primary: "#fb923c", secondary: "#fb923c" },
    { name: "orange", title: "Orange", primary: "#f97316", secondary: "#f97316" },
    { name: "orange-dark", title: "Orange Dark", primary: "#c2410c", secondary: "#c2410c" },

    { name: "amber-light", title: "Amber Light", primary: "#fbbf24", secondary: "#fbbf24" },
    { name: "amber", title: "Amber Gold", primary: "#f59e0b", secondary: "#f59e0b" },
    { name: "amber-dark", title: "Amber Dark", primary: "#b45309", secondary: "#b45309" },

    { name: "lime-light", title: "Lime Light", primary: "#a3e635", secondary: "#a3e635" },
    { name: "lime", title: "Lime", primary: "#84cc16", secondary: "#84cc16" },
    { name: "lime-dark", title: "Lime Dark", primary: "#4d7c0f", secondary: "#4d7c0f" },

    { name: "emerald-light", title: "Emerald Light", primary: "#34d399", secondary: "#34d399" },
    { name: "emerald", title: "Emerald Green", primary: "#10b981", secondary: "#10b981" },
    { name: "emerald-dark", title: "Emerald Dark", primary: "#047857", secondary: "#047857" },

    { name: "teal-light", title: "Teal Light", primary: "#2dd4bf", secondary: "#2dd4bf" },
    { name: "teal", title: "Teal", primary: "#14b8a6", secondary: "#14b8a6" },
    { name: "teal-dark", title: "Teal Dark", primary: "#0f766e", secondary: "#0f766e" },

    { name: "cyan-light", title: "Cyan Light", primary: "#22d3ee", secondary: "#22d3ee" },
    { name: "cyan", title: "Cyan", primary: "#06b6d4", secondary: "#06b6d4" },
    { name: "cyan-dark", title: "Cyan Dark", primary: "#0e7490", secondary: "#0e7490" },

    { name: "sky-light", title: "Sky Light", primary: "#38bdf8", secondary: "#38bdf8" },
    { name: "sky", title: "Sky Blue", primary: "#0ea5e9", secondary: "#0ea5e9" },
    { name: "sky-dark", title: "Sky Dark", primary: "#0369a1", secondary: "#0369a1" },

    { name: "blue-light", title: "Blue Light", primary: "#60a5fa", secondary: "#60a5fa" },
    { name: "blue", title: "Blue (Default)", primary: "#3b82f6", secondary: "#3b82f6" },
    { name: "blue-dark", title: "Blue Dark", primary: "#1d4ed8", secondary: "#1d4ed8" },

    { name: "indigo-light", title: "Indigo Light", primary: "#818cf8", secondary: "#818cf8" },
    { name: "indigo", title: "Indigo", primary: "#6366f1", secondary: "#6366f1" },
    { name: "indigo-dark", title: "Indigo Dark", primary: "#4338ca", secondary: "#4338ca" },

    { name: "purple-light", title: "Purple Light", primary: "#a78bfa", secondary: "#a78bfa" },
    { name: "purple", title: "Electric Purple", primary: "#8b5cf6", secondary: "#8b5cf6" },
    { name: "purple-dark", title: "Purple Dark", primary: "#6d28d9", secondary: "#6d28d9" },

    { name: "violet-light", title: "Violet Light", primary: "#c084fc", secondary: "#c084fc" },
    { name: "violet", title: "Violet", primary: "#a855f7", secondary: "#a855f7" },
    { name: "violet-dark", title: "Violet Dark", primary: "#7e22ce", secondary: "#7e22ce" },

    { name: "pink-light", title: "Pink Light", primary: "#f472b6", secondary: "#f472b6" },
    { name: "pink", title: "Pink", primary: "#ec4899", secondary: "#ec4899" },
    { name: "pink-dark", title: "Pink Dark", primary: "#be185d", secondary: "#be185d" },

    { name: "rose-light", title: "Rose Light", primary: "#fb7185", secondary: "#fb7185" },
    { name: "rose", title: "Rose Red", primary: "#f43f5e", secondary: "#f43f5e" },
    { name: "rose-dark", title: "Rose Dark", primary: "#be123c", secondary: "#be123c" },
  ];

  window.QN_THEMES = QN_THEMES;

  const mount = document.getElementById('qnMenuMount');
  if (!mount) return; // ホスト側にマウント先が無ければ何もしない

  /* ---------- Color conversion helpers ---------- */
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  }

  function hexToHue(hex) {
    hex = hex.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    const d = max - min;
    if (d !== 0) {
      switch (max) {
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    return h;
  }

  // 明度をfactor倍だけ落とした色を返す（1に近いほど元の明るさに近い、
  // 小さいほど暗くなる）。hover色の自動計算に使う。
  function darken(hex, factor) {
    hex = hex.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    return hslToHex(h, s * 100, Math.max(0, l * factor) * 100);
  }

  /* ---------- テーマCSS・スウォッチの動的生成 ----------
     QN_THEMES配列から、CSSカスタムプロパティ(--accent-*)とスウォッチの
     背景グラデーションをまとめた<style>タグを1つ生成してheadに注入し、
     スウォッチのHTML(.qn-theme-swatch)も同じ配列から生成して
     #qnThemeSwatchesに流し込む。style-theme.css/index.html側には
     テーマごとの個別記述を持たせない。 */
  function buildThemeCssAndSwatches() {
    const cssParts = [];
    QN_THEMES.forEach(t => {
      // 単色テーマ方針：--accent-secondaryもprimaryと同じ値にし、
      // グラデーション表現(Playボタン・ロゴ文字等)が実質単色に見えるようにする。
      // hover色の計算だけは、元のsecondary値から作った少し暗いトーンを
      // 引き続き使う（primaryだけだとhover時の変化が乏しくなるため）。
      const hover1 = darken(t.primary, 0.82);
      const hover2 = darken(t.primary, 0.78);
      const r = parseInt(t.primary.slice(1, 3), 16);
      const g = parseInt(t.primary.slice(3, 5), 16);
      const b = parseInt(t.primary.slice(5, 7), 16);
      cssParts.push(
        `[data-qn-theme="${t.name}"]{--accent-primary:${t.primary};--accent-secondary:${t.primary};` +
        `--accent-glow:rgba(${r},${g},${b},0.35);--accent-hover-1:${hover1};--accent-hover-2:${hover2};}`
      );
      cssParts.push(
        `.qn-swatch-${t.name}{background:${t.primary};}`
      );
    });
    const styleTag = document.createElement('style');
    styleTag.id = 'qnThemeGeneratedCss';
    styleTag.textContent = cssParts.join('\n');
    document.head.appendChild(styleTag);

    const visibleContainer = document.getElementById('qnThemeSwatches');
    if (!visibleContainer) return;

    QN_THEMES.forEach(t => {
      const swatch = document.createElement('div');
      swatch.className = `qn-theme-swatch qn-swatch-${t.name}`;
      swatch.setAttribute('data-qn-theme', t.name);
      swatch.title = t.title;
      visibleContainer.appendChild(swatch);
    });
  }
  buildThemeCssAndSwatches();

  // テーマ切替時、前のテーマで設定されていたインラインstyle(--accent-*)を
  // クリアする（旧rainbow機能が使っていた仕組みの名残）。通常のテーマは
  // [data-qn-theme]のCSSカスタムプロパティだけで表現されるため、
  // インラインstyleを都度リセットしないと古い値が残ってしまう。
  function clearInlineAccentProps() {
    ['--accent-primary', '--accent-secondary', '--accent-glow', '--accent-hover-1', '--accent-hover-2'].forEach(v => {
      document.body.style.removeProperty(v);
    });
  }

  /* ---------- Glow animation ---------- */
  let glowAnimId = null;
  let glowEnabled = false;

  function stopGlow() {
    window.__qnGlowBaseAccent = null;
    if (glowAnimId) {
      cancelAnimationFrame(glowAnimId);
      glowAnimId = null;
    }
    ['--accent-primary', '--accent-secondary', '--accent-glow', '--accent-hover-1', '--accent-hover-2'].forEach(v => {
      document.body.style.removeProperty(v);
    });
  }

  function startGlow() {
    if (glowAnimId) cancelAnimationFrame(glowAnimId);
    const baseColor = getComputedStyle(document.body).getPropertyValue('--accent-primary').trim() || '#3b82f6';
    const fixedHue = hexToHue(baseColor);
    // 【v2.13.5】波形(シークバー)はGlowの明滅対象外にする。波形側は
    // この「明滅前の元のアクセント色」を固定で使うため、Glow中でも色が
    // 変わらず、再描画も走らない（停止中の波形描画がゼロになる）。
    window.__qnGlowBaseAccent = baseColor;
    // 【v2.13.4 負荷対策】body上のCSS変数を書き換えると画面全体のスタイル再計算が
    // 走るため、毎フレームではなく約15回/秒に間引く。明滅の速さは経過時間ベースで
    // 計算するので、間引いても以前（0.008/フレーム@60fps）と同じ速さになる。
    const glowStart = performance.now();
    let lastGlowAt = 0;
    function stepGlow(now) {
      glowAnimId = requestAnimationFrame(stepGlow);
      now = now || performance.now();
      if (document.hidden || (now - lastGlowAt) < 66) return;
      lastGlowAt = now;
      const t = (now - glowStart) * 0.00048;
      const lightness = 50 + Math.sin(t) * 15;
      const primary = hslToHex(fixedHue, 75, lightness);
      const secondary = hslToHex(fixedHue, 75, Math.max(20, lightness - 20));
      const hoverA = hslToHex(fixedHue, 80, Math.min(75, lightness + 8));
      const hoverB = hslToHex(fixedHue, 75, Math.max(15, lightness - 25));
      document.body.style.setProperty('--accent-primary', primary);
      document.body.style.setProperty('--accent-secondary', secondary);
      document.body.style.setProperty('--accent-glow', primary + '59');
      document.body.style.setProperty('--accent-hover-1', hoverA);
      document.body.style.setProperty('--accent-hover-2', hoverB);
    }
    stepGlow(performance.now());
  }

  function setGlowEnabled(enabled) {
    glowEnabled = enabled;
    try { localStorage.setItem(GLOW_STORAGE_KEY, enabled ? 'on' : 'off'); } catch (e) {}
    const btn = document.getElementById('qnGlowToggleBtn');
    if (btn) btn.setAttribute('aria-checked', enabled ? 'true' : 'false');
    if (enabled) {
      startGlow();
    } else {
      stopGlow();
    }
  }

  function updateActiveSwatch(themeName) {
    document.querySelectorAll('.qn-theme-swatch').forEach(s => {
      s.classList.toggle('active', s.getAttribute('data-qn-theme') === themeName);
    });
  }

  /* ---------- Theme init & events ---------- */
  let storedTheme = null;
  try { storedTheme = localStorage.getItem(THEME_STORAGE_KEY); } catch (e) {}
  const initialTheme = storedTheme || 'blue';
  document.body.setAttribute('data-qn-theme', initialTheme);
  updateActiveSwatch(initialTheme);
  clearInlineAccentProps();

  document.querySelectorAll('.qn-theme-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const themeName = swatch.getAttribute('data-qn-theme');
      document.body.setAttribute('data-qn-theme', themeName);
      try { localStorage.setItem(THEME_STORAGE_KEY, themeName); } catch (e) {}
      updateActiveSwatch(themeName);
      clearInlineAccentProps();
      if (glowEnabled) startGlow();

      // カラーテーマ選択時はメニューを閉じない。色を連続で切り替えながら
      // 見た目を比較したいというユースケースのため、他の操作（メニュー外click等）
      // で閉じるのはそのまま維持し、ここだけ閉じる処理を意図的に呼ばない。
    });
  });

  const glowToggleBtn = document.getElementById('qnGlowToggleBtn');
  if (glowToggleBtn) {
    let savedGlow = false;
    try { savedGlow = localStorage.getItem(GLOW_STORAGE_KEY) === 'on'; } catch (e) {}
    if (savedGlow) setGlowEnabled(true);
    glowToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setGlowEnabled(!glowEnabled);
    });
  }

  /* ---------- Keyboard shortcuts section (reads window.QN_SHORTCUTS) ---------- */
  const shortcutsSection = document.getElementById('qnShortcutsSection');
  const shortcutsTbody = document.getElementById('qnShortcutsTbody');
  const shortcuts = window.QN_SHORTCUTS;
  if (Array.isArray(shortcuts) && shortcuts.length > 0 && shortcutsSection && shortcutsTbody) {
    shortcuts.forEach(row => {
      const tr = document.createElement('tr');
      const tdAction = document.createElement('td');
      tdAction.textContent = row.action;
      const tdKey = document.createElement('td');
      // key は "Space" のような単一表記、または "↑ ↓" のように
      // スペース区切りで複数キーをまとめて1セルに入れてよい。
      // "+" "/" "-" は実際に押すキーではなく、組み合わせを示す説明記号
      // のため、<kbd>の枠は付けずにプレーンテキストとして挟む。
      const connectorTokens = ['+', '/', '-'];
      String(row.key).split(' ').forEach((part, i) => {
        if (i > 0) tdKey.appendChild(document.createTextNode(' '));
        if (connectorTokens.includes(part)) {
          tdKey.appendChild(document.createTextNode(part));
        } else {
          const kbd = document.createElement('kbd');
          kbd.textContent = part;
          tdKey.appendChild(kbd);
        }
      });
      tr.appendChild(tdAction);
      tr.appendChild(tdKey);
      shortcutsTbody.appendChild(tr);
    });
  } else if (shortcutsSection) {
    // window.QN_SHORTCUTS が無い/空のアプリでは Section 3 を丸ごと非表示にする
    shortcutsSection.style.display = 'none';
  }
})();
