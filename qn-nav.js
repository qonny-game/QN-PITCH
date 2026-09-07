/* ============================================================
   qn-nav.js — placeholder
   他のQNシリーズアプリ（QNPLAYER / QNTUNER / QNTEMPO）で使用している
   実物のqn-nav.jsに差し替えてください。現状はcurrentクラスの
   付与とハンバーガーメニューの開閉のみを行うフォールバックです。
   ============================================================ */
(function () {
  'use strict';
  var currentApp = 'pitch';
  document.querySelectorAll('.qn-nav-item').forEach(function (item) {
    if (item.dataset.qnApp === currentApp) {
      item.classList.add('current');
    }
  });

  var hamburger = document.getElementById('qnNavHamburger');
  var dropdown = document.getElementById('qnNavDropdown');
  if (!hamburger || !dropdown) return;

  function closeDropdown() {
    dropdown.classList.remove('open');
    hamburger.classList.remove('active');
  }

  hamburger.addEventListener('click', function (e) {
    e.stopPropagation();
    var willOpen = !dropdown.classList.contains('open');
    dropdown.classList.toggle('open', willOpen);
    hamburger.classList.toggle('active', willOpen);
  });

  document.addEventListener('click', function (e) {
    if (!dropdown.contains(e.target) && e.target !== hamburger) {
      closeDropdown();
    }
  });
})();
