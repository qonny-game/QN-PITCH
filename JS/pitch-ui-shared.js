// ============================================================
// pitch-ui-shared.js
// PC v2共通のUI操作。
//
// 【由来】QNPLAYERのplayer-ui-shared.js（1072行）を精査した結果、
// 大半がplayer-core.js（audio, playlist等のQNPLAYER固有の状態）に
// 依存する波形描画・再生制御・Media Session連携で、QNPITCHには対応
// する概念が無いため移植していない。以下の3つの型だけを、変数名・
// ロジックをそのまま踏襲して抽出している：
//   - haptic系（hapticTap/hapticTick/hapticSuccess/hapticWarning）
//   - モバイルタブ切替（applyMobileTabLayout/setMobileTab、
//     .mobile-tab-panelの表示切替）
//   - スライダー進捗表示（.control-card input[type="range"]の
//     --range-progress CSS変数を同期するrequestAnimationFrameループ）
// ============================================================

// ============================================================
// サイドバーのタブ切替（Tone Generator/Sensitivity/Filters/
// Recordings、#sidebarSection内の.mobile-tab-panel）。
// pitch-ui-pc-v2.js側のswitchPanel()からも呼ばれる共通ロジック。
// ============================================================
const mobileTabBtns = Array.from(document.querySelectorAll(".mobile-tab-btn"));
let currentMobileTab = "control";

function applyMobileTabLayout() {
  document.querySelectorAll(".mobile-tab-panel").forEach(panel => {
    const tabName = panel.getAttribute("data-tab-panel");
    panel.classList.toggle("mobile-tab-active", tabName === currentMobileTab);
  });
}

function setMobileTab(tabName) {
  currentMobileTab = tabName;
  mobileTabBtns.forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
  });
  applyMobileTabLayout();
}

mobileTabBtns.forEach(btn => {
  btn.onclick = () => {
    hapticTap();
    setMobileTab(btn.getAttribute("data-tab"));
  };
});

setMobileTab("control");

// ============================================================
// 触覚フィードバック（QNPLAYERと同じ強度・パターン。標準実装ルール
// として今後の新規QNアプリでも踏襲する）。
//   tap     : ボタン全般の押下、タブ切替、ポップアップ開閉、スウォッチ選択
//   tick    : スライダーが目盛りの区切りを跨いだ瞬間（呼び出し側で間引くこと）
//   success : 保存完了など「達成」の区切り
//   warning : 削除確認、エラーなど注意を引きたい場面
// ============================================================
function hapticTap() {
  if (navigator.vibrate) navigator.vibrate(10);
}
function hapticTick() {
  if (navigator.vibrate) navigator.vibrate(6);
}
function hapticSuccess() {
  if (navigator.vibrate) navigator.vibrate([15, 40, 15]);
}
function hapticWarning() {
  if (navigator.vibrate) navigator.vibrate([20, 60, 20, 60, 20]);
}

// ============================================================
// Sensitivity/Smoothingスライダー等(.control-card input[type="range"])
// のCSS変数(--range-progress)更新。style-core.css側で
// .control-card input[type="range"]::-webkit-slider-runnable-trackが
// この変数を見て進捗より左側だけaccent-primary色に塗り分ける仕組み。
// 軽量なrequestAnimationFrameループで継続的に同期する。
// ============================================================
(function syncRangeProgressLoop() {
  const targets = Array.from(document.querySelectorAll(".control-card input[type=\"range\"]"));
  const lastValues = new Map();
  let lastTickAt = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    if (document.hidden || (now - lastTickAt) < 200) return;
    lastTickAt = now;
    targets.forEach(input => {
      if (lastValues.get(input) !== input.value) {
        lastValues.set(input, input.value);
        const min = parseFloat(input.min) || 0;
        const max = parseFloat(input.max) || 100;
        const val = parseFloat(input.value);
        const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
        input.style.setProperty("--range-progress", String(pct));
      }
    });
  }
  if (targets.length > 0) requestAnimationFrame(tick);
})();
