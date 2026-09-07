/* ============================================================
   qn-nav.js — placeholder
   他のQNシリーズアプリ（QNPLAYER / QNTUNER / QNTEMPO）で使用している
   実物のqn-nav.jsに差し替えてください。現状はcurrentクラスの
   付与のみを最低限行うフォールバックです。
   ============================================================ */
(function () {
  'use strict';
  var currentApp = 'pitch';
  document.querySelectorAll('.qn-nav-btn').forEach(function (btn) {
    if (btn.dataset.qnApp === currentApp) {
      btn.classList.add('current');
    }
  });
})();
