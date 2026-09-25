// ============================================================
// pitch-recordings.js
// 録音の保存・一覧・リネーム（IndexedDB: qnpitch_recordings_db）。
//
// 【移植元】旧QNPITCH(app.js)のdbAddRecording/dbGetAllRecordings/
// dbDeleteRecording/dbRenameRecordingを移植。保存/リネーム/クリア
// 確認ダイアログは、QNPLAYERのexport-modal-overlay型（.openクラスで
// 開閉）をそのまま使う（index.html側に静的HTMLとして用意済み）。
// ============================================================

window.QNPitch = window.QNPitch || {};

(function () {
  const DB_NAME = 'qnpitch_recordings_db';
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

  // ==================== 一時パネル（Save/Rename/Clear確認） ====================
  // 【v1.0.2】中央寄せのモーダルオーバーレイをやめ、アイコンバーの
  // Panel領域（#pcV2PanelBody）に一時的に表示する方式に変更した
  // （ユーザー指示：「パネルの位置に表示すれば、スッキリする」）。
  // window.QNPitch.openTemporaryPanel(panelId)（pitch-ui-pc-v2.js側）
  // でパネルを開き、switchPanel()がwindow.QNPitch.renderTemporaryPanel
  // を呼んで中身を構築する。中身のCSSはQNPLAYERのexport-section系
  // クラス（.export-section-label、.export-filename-input、
  // .export-run-btn等）をそのまま流用する。

  // 現在開いている一時パネルの決着(resolve)関数。ボタン操作が来るまで
  // Promiseを保留しておき、SAVE/OK/Cancel等が押されたらこれを呼ぶ。
  let pendingResolve = null;

  function renderTemporaryPanel(panelId, panelBody) {
    if (panelId === 'save-dialog') {
      renderNamePanel(panelBody, { defaultName: pendingDefaultName, okLabel: 'Save' });
    } else if (panelId === 'rename-dialog') {
      renderNamePanel(panelBody, { defaultName: pendingDefaultName, okLabel: 'OK' });
    } else if (panelId === 'clear-confirm') {
      renderClearConfirmPanel(panelBody);
    }
  }
  window.QNPitch.renderTemporaryPanel = renderTemporaryPanel;

  function renderNamePanel(panelBody, opts) {
    panelBody.innerHTML =
      '<div class="export-section">' +
        '<label class="export-section-label">Name</label>' +
        '<input type="text" id="pitchTempNameInput" class="export-filename-input" maxlength="30">' +
      '</div>' +
      '<div class="pitch-temp-panel-footer">' +
        '<button id="pitchTempCancelBtn" class="export-cancel-btn" title="Cancel">Cancel</button>' +
        '<button id="pitchTempOkBtn" class="export-run-btn">' + opts.okLabel + '</button>' +
      '</div>';
    const input = document.getElementById('pitchTempNameInput');
    input.value = opts.defaultName;
    input.focus();
    input.select();

    const finish = (val) => {
      if (pendingResolve) { pendingResolve(val); pendingResolve = null; }
      window.QNPitch.closeTemporaryPanel();
    };
    document.getElementById('pitchTempOkBtn').addEventListener('click', () => {
      finish(input.value.trim() || opts.defaultName);
    });
    document.getElementById('pitchTempCancelBtn').addEventListener('click', () => finish(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value.trim() || opts.defaultName);
      if (e.key === 'Escape') finish(null);
    });
  }

  function renderClearConfirmPanel(panelBody) {
    panelBody.innerHTML =
      '<div class="export-section">' +
        '<p class="pitch-clear-confirm-desc">表示中のピッチロールを消去します。未保存の録音がある場合は破棄されます。</p>' +
      '</div>' +
      '<div class="pitch-temp-panel-footer">' +
        '<button id="pitchTempCancelBtn" class="export-cancel-btn" title="Cancel">Cancel</button>' +
        '<button id="pitchTempOkBtn" class="export-run-btn export-run-btn-danger">Clear</button>' +
      '</div>';
    const finish = (val) => {
      if (pendingResolve) { pendingResolve(val); pendingResolve = null; }
      window.QNPitch.closeTemporaryPanel();
    };
    document.getElementById('pitchTempOkBtn').addEventListener('click', () => finish(true));
    document.getElementById('pitchTempCancelBtn').addEventListener('click', () => finish(false));
  }

  let pendingDefaultName = '';

  function openSaveDialog(defaultName) {
    pendingDefaultName = defaultName;
    return new Promise((resolve) => {
      pendingResolve = resolve;
      window.QNPitch.openTemporaryPanel('save-dialog');
    });
  }

  function openRenameDialog(currentName) {
    pendingDefaultName = currentName;
    return new Promise((resolve) => {
      pendingResolve = resolve;
      window.QNPitch.openTemporaryPanel('rename-dialog');
    });
  }

  function openClearConfirmDialog() {
    return new Promise((resolve) => {
      pendingResolve = resolve;
      window.QNPitch.openTemporaryPanel('clear-confirm');
    });
  }

  // ==================== 録音一覧（Recordingsパネル） ====================
  async function refreshRecList() {
    const scrollEl = document.getElementById('pitchRecListScroll');
    if (!scrollEl) return;
    const list = await dbGetAllRecordings();
    const currentPlayback = window.QNPitch.pitchMode && window.QNPitch.pitchMode.getCurrentPlaybackId
      ? window.QNPitch.pitchMode.getCurrentPlaybackId() : null;

    scrollEl.innerHTML = '';
    if (!list.length) {
      scrollEl.innerHTML = '<p class="pitch-rec-list-empty">まだ録音がありません</p>';
      return;
    }
    list.forEach(function (item) {
      const row = document.createElement('div');
      row.className = 'pitch-rec-row';
      row.dataset.recordingId = String(item.id);
      if (currentPlayback === item.id) row.classList.add('playing');

      let metaText = formatDateTime(item.createdAt) + ' ・ ' + formatDuration(item.duration);
      if (item.score !== null && item.score !== undefined) metaText += ' ・ ' + item.score + '%';

      row.innerHTML =
        '<button type="button" class="del-btn" title="Select"></button>' +
        '<div class="pitch-rec-row-icon"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>' +
        '<div class="pitch-rec-row-info">' +
          '<div class="pitch-rec-row-name"></div>' +
          '<div class="pitch-rec-row-meta"></div>' +
        '</div>' +
        '<button type="button" class="pitch-rec-row-edit"><svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>';

      row.querySelector('.pitch-rec-row-name').textContent = item.name;
      row.querySelector('.pitch-rec-row-meta').textContent = metaText;

      row.querySelector('.pitch-rec-row-edit').addEventListener('click', async (e) => {
        e.stopPropagation();
        const newName = await openRenameDialog(item.name);
        if (newName && newName !== item.name) {
          await dbRenameRecording(item.id, newName);
          await refreshRecList();
        }
      });
      row.addEventListener('click', (e) => {
        if (e.target.closest('.del-btn') || e.target.closest('.pitch-rec-row-edit')) return;
        if (window.QNPitch.pitchMode && typeof window.QNPitch.pitchMode.selectRecording === 'function') {
          window.QNPitch.pitchMode.selectRecording(item);
        }
      });

      scrollEl.appendChild(row);
    });
  }

  window.QNPitch.recordings = {
    dbAddRecording,
    dbGetAllRecordings,
    dbDeleteRecording,
    dbRenameRecording,
    makeRecordingName,
    formatDateTime,
    formatDuration,
    openSaveDialog,
    openRenameDialog,
    openClearConfirmDialog,
    refreshRecList
  };
})();
