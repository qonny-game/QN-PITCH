// ============================================================
// pitch-recordings.js
// 録音の保存・一覧・リネーム（IndexedDB: qnpitch_recordings_db）。
//
// 【移植元】旧QNPITCH(app.js)のdbAddRecording/dbGetAllRecordings/
// dbDeleteRecording/dbRenameRecording、および保存/リネームダイアログ
// （openSaveDialog/openRenameDialog）を移植。
// md/AI_ASSISTANT_PROJECT_CONTEXT.md §0-2の通り、IndexedDBの
// データベース名にはqnpitch_接頭辞を付ける（旧QNPITCHの'qnpitch-db'
// から'qnpitch_recordings_db'に変更）。
//
// pitch-mode-pitch.js から window.QNPitch.recordings として参照される。
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

  // ==================== ダイアログ（Promiseで待ち受け） ====================
  // OK→名前, キャンセル→null。DOM構造はpitch-mode-pitch.jsがindex.html
  // 相当のモーダル一式を用意する前提で、id経由で参照する。
  function openNameDialog(opts) {
    const backdrop = document.getElementById(opts.backdropId);
    const input = document.getElementById(opts.inputId);
    const okBtn = document.getElementById(opts.okBtnId);
    const cancelBtn = document.getElementById(opts.cancelBtnId);
    return new Promise((resolve) => {
      if (!backdrop || !input || !okBtn || !cancelBtn) { resolve(null); return; }
      input.value = opts.defaultName;
      backdrop.classList.add('open');
      input.focus();

      function cleanup() {
        backdrop.classList.remove('open');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onBackdropClick);
      }
      function onOk() {
        const val = input.value.trim() || opts.defaultName;
        cleanup();
        resolve(val);
      }
      function onCancel() {
        cleanup();
        resolve(null);
      }
      function onBackdropClick(e) {
        if (e.target === backdrop) onCancel();
      }
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onBackdropClick);
    });
  }

  function openSaveDialog(defaultName) {
    return openNameDialog({
      backdropId: 'pitchSaveBackdrop',
      inputId: 'pitchSaveNameInput',
      okBtnId: 'pitchSaveOkBtn',
      cancelBtnId: 'pitchSaveCancelBtn',
      defaultName
    });
  }

  function openRenameDialog(currentName) {
    return openNameDialog({
      backdropId: 'pitchRenameBackdrop',
      inputId: 'pitchRenameNameInput',
      okBtnId: 'pitchRenameOkBtn',
      cancelBtnId: 'pitchRenameCancelBtn',
      defaultName: currentName
    });
  }

  // モーダル一式のDOMを用意する（一度だけ）。pitch-mode-pitch.jsの
  // 起動時に呼ぶ。
  function ensureDialogsInDom() {
    if (document.getElementById('pitchSaveBackdrop')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="pitch-dialog-backdrop" id="pitchSaveBackdrop">' +
        '<div class="pitch-dialog">' +
          '<p class="pitch-popup-title">Save Recording</p>' +
          '<input type="text" id="pitchSaveNameInput" class="pitch-name-input" maxlength="30">' +
          '<div class="pitch-dialog-btn-row">' +
            '<button type="button" class="pitch-dialog-btn" id="pitchSaveCancelBtn">Cancel</button>' +
            '<button type="button" class="pitch-dialog-btn pitch-dialog-btn-primary" id="pitchSaveOkBtn">OK</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="pitch-dialog-backdrop" id="pitchRenameBackdrop">' +
        '<div class="pitch-dialog">' +
          '<p class="pitch-popup-title">Rename</p>' +
          '<input type="text" id="pitchRenameNameInput" class="pitch-name-input" maxlength="30">' +
          '<div class="pitch-dialog-btn-row">' +
            '<button type="button" class="pitch-dialog-btn" id="pitchRenameCancelBtn">Cancel</button>' +
            '<button type="button" class="pitch-dialog-btn pitch-dialog-btn-primary" id="pitchRenameOkBtn">OK</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="pitch-dialog-backdrop" id="pitchClearConfirmBackdrop">' +
        '<div class="pitch-dialog">' +
          '<p class="pitch-popup-title">Clear Roll?</p>' +
          '<p class="pitch-clear-confirm-desc">表示中のピッチロールを消去します。未保存の録音がある場合は破棄されます。</p>' +
          '<div class="pitch-dialog-btn-row">' +
            '<button type="button" class="pitch-dialog-btn" id="pitchClearConfirmCancelBtn">Cancel</button>' +
            '<button type="button" class="pitch-dialog-btn pitch-dialog-btn-danger" id="pitchClearConfirmOkBtn">Clear</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  function openClearConfirmDialog() {
    const backdrop = document.getElementById('pitchClearConfirmBackdrop');
    const okBtn = document.getElementById('pitchClearConfirmOkBtn');
    const cancelBtn = document.getElementById('pitchClearConfirmCancelBtn');
    return new Promise((resolve) => {
      if (!backdrop || !okBtn || !cancelBtn) { resolve(false); return; }
      backdrop.classList.add('open');
      function cleanup() {
        backdrop.classList.remove('open');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onBackdropClick);
      }
      function onOk() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      function onBackdropClick(e) { if (e.target === backdrop) onCancel(); }
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onBackdropClick);
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
    ensureDialogsInDom
  };
})();
