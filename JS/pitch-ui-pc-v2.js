// ============================================================
// pitch-ui-pc-v2.js
// QNPITCH PC v2：左アイコンバー＋中央パネル＋右メインエリアの3カラム
// レイアウト（SP幅ではCSS側の@media(max-width:900px)で縦積みに切替）。
// QNPLAYERのplayer-ui-pc-v2.jsが土台（経緯はmd/AI_ASSISTANT_PROJECT_
// CONTEXT.md §0-2参照）。
// 依存：pitch-core.js, pitch-ui-shared.js, pitch-filters.js,
// pitch-recordings.js, pitch-mode-tuner.js, pitch-mode-pitch.js
// より後に読み込むこと。
// ============================================================

(function () {
  window.QNPitch = window.QNPitch || {};

  const PC_BREAKPOINT = "(min-width: 0px)";
  const mql = window.matchMedia(PC_BREAKPOINT);

  let built = false;
  let currentPanel = "control"; // 初期パネル（TUNERMODEのTone Generator）
  let currentMode = "tuner"; // "tuner" | "pitch"（QNPITCH固有、QNPLAYERには無い概念）

  // アイコンバーに並べる項目。
  // panelType: "tab" = 既存の.mobile-tab-panel(#sidebarSection内)をそのまま表示
  //            "close" = パネルを開かず、開いていれば閉じる（TUNERMODE/
  //                      PITCHMODEのメインエリアが見える基本画面に戻る
  //                      ためのショートカット。SP幅専用の挙動で、PC幅
  //                      では常時パネル表示のため実質何もしない）
  // modes: そのアイコンをどのMODE（tuner/pitch）で表示するか（QNPITCH
  //        固有の拡張。省略時は両モードで表示）。
  const ICON_ITEMS = [
    {
      id: "mainview",
      label: "View",
      panelType: "close",
      icon: '<path d="M4 5h2v14H4zm4 3h2v8H8zm4-6h2v20h-2zm4 4h2v12h-2zm4 3h2v6h-2z"/>'
    },
    {
      id: "control",
      label: "Tone Generator",
      shortLabel: "Tone",
      panelType: "tab",
      tabName: "control",
      modes: ["tuner"],
      icon: '<path d="M9 2v2h6V2h2v2.06c1.14.2 2 1.2 2 2.4 0 .77-.35 1.46-.9 1.92L20 20H4l1.9-11.62A2.5 2.5 0 0 1 5 6.46c0-1.2.86-2.2 2-2.4V2h2z"/>'
    },
    {
      id: "markers",
      label: "Sensitivity",
      panelType: "tab",
      tabName: "markers",
      modes: ["tuner"],
      icon: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-2h2zm0-4h-2V7h2z"/>'
    },
    {
      id: "display",
      label: "Display",
      panelType: "tab",
      tabName: "display",
      modes: ["tuner"],
      icon: '<path d="M4 5h16v10H4V5zm0 12h16v2H4v-2zM12 8l-3 3h6l-3-3z"/>'
    },
    {
      id: "playlist",
      label: "Filters",
      panelType: "tab",
      tabName: "playlist",
      modes: ["pitch"],
      icon: '<path d="M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39A.998.998 0 0 0 18.95 4H5.04c-.83 0-1.3.95-.79 1.61z"/>'
    },
    {
      id: "text",
      label: "Recordings",
      panelType: "tab",
      tabName: "text",
      modes: ["pitch"],
      icon: '<path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2z"/>'
    }
  ];

  // アイコンバー下段：Keyboard Shortcuts / Color Theme
  // （QNPLAYERと同じ、qnMenuMount内のセクションをDOM移動して表示。
  // このICON_ITEMS配列には含めず、build()側で別途固定追加する）


  function el(html) {
    const div = document.createElement("div");
    div.innerHTML = html.trim();
    return div.firstChild;
  }

  // 上段アイコン一覧を、現在のcurrentModeでフィルタして描画する。
  // QNPITCH固有（QNPLAYERにはMODE概念が無い）：ICON_ITEMSのmodesが
  // 現在のモードを含まない項目は表示しない。build()時と、setMode()
  // 呼び出し時の両方から呼ばれる。
  function renderIconBarItems(iconBar) {
    // 直接の子要素のみ対象（子孫全体だとbottomGroup内も巻き込み削除する。md §2-6）。
    Array.from(iconBar.children).forEach(b => {
      if (b.classList.contains("pcv2-icon-item")) b.remove();
    });
    // 挿入位置は必ずspacerの直前（bottomGroupの直前だとズレる。md §2-9）。
    const spacer = iconBar.querySelector("#pcV2IconBarSpacer");
    ICON_ITEMS.forEach(item => {
      if (item.hidden) return;
      if (item.modes && !item.modes.includes(currentMode)) return;
      const displayLabel = item.shortLabel || item.label;
      const btn = el(
        '<button type="button" class="pcv2-icon-item" data-panel-id="' + item.id + '" title="' + item.label + '">' +
          '<svg viewBox="0 0 24 24">' + item.icon + '</svg>' +
          '<span>' + displayLabel + '</span>' +
        '</button>'
      );
      btn.addEventListener("click", () => handleIconClick(item));
      // spacerより前（上段の並び順を保つ）に挿入する。build()時は
      // まだspacerが存在しないため、その場合は末尾に追加する。
      if (spacer) {
        iconBar.insertBefore(btn, spacer);
      } else {
        iconBar.appendChild(btn);
      }
    });
  }

  function build() {
    if (built) return;
    built = true;

    const appContainer = document.querySelector(".app-container");
    if (!appContainer) { built = false; return; }

    // --- 骨組みDOMを作成（既存要素はまだ動かさず、器だけ用意する） ---
    const layout = el('<div id="pcV2Layout"></div>');
    const iconBar = el('<div id="pcV2IconBar"></div>');
    const panel = el('<div id="pcV2Panel"></div>');
    const panelHeader = el('<div id="pcV2PanelHeader"></div>');
    const panelBody = el('<div id="pcV2PanelBody"></div>');
    const waveArea = el('<div id="pcV2WaveArea"></div>');

    panel.appendChild(panelHeader);
    panel.appendChild(panelBody);

    renderIconBarItems(iconBar);

    // アイコンバー下段：Keyboard Shortcuts / Color Theme。
    // #qnMenuMount内（player-theme.js/style-theme.css）のセクションを
    // DOMごと移動してパネルとして表示する。
    const spacer = el('<div id="pcV2IconBarSpacer"></div>');
    const bottomGroup = el('<div id="pcV2IconBarBottom"></div>');
    [
      { id: "keyboard", label: "Keyboard", icon: '<path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zM11 8h2v2h-2V8zM11 11h2v2h-2v-2zM8 8h2v2H8V8zM8 11h2v2H8v-2zM5 8h2v2H5V8zm0 3h2v2H5v-2zm10 6H9v-2h6v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/>' },
      { id: "color", label: "Color", icon: '<path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.2-.64-1.67-.08-.09-.13-.21-.13-.33 0-.28.22-.5.5-.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 8 6.5 8 8 8.67 8 9.5 7.33 11 6.5 11zm3-4C8.67 7 8 6.33 8 5.5S8.67 4 9.5 4s1.5.67 1.5 1.5S10.33 7 9.5 7zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 4 14.5 4s1.5.67 1.5 1.5S15.33 7 14.5 7zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 8 17.5 8s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>' }
    ].forEach(entry => {
      const btn = el(
        '<button type="button" class="pcv2-icon-item" data-panel-id="' + entry.id + '" title="' + entry.label + '">' +
          '<svg viewBox="0 0 24 24">' + entry.icon + '</svg>' +
          '<span>' + entry.label + '</span>' +
        '</button>'
      );
      btn.addEventListener("click", () => openPanelOverlay(entry.id));
      bottomGroup.appendChild(btn);
    });
    iconBar.appendChild(spacer);
    iconBar.appendChild(bottomGroup);

    // --- アイコンバーの右端「まだ続きがある」ヒント矢印（SP幅専用） ---
    // #pcV2IconBarは横スクロールするため、右端に固定表示の矢印ヒントを重ねる
    // （layoutの直接の子として絶対配置。style-layout-pc-v2.css側参照）。
    // 表示/非表示はsetupIconBarScrollHintがスクロール位置を見て切り替える。
    const iconBarScrollHint = el(
      '<div id="pcV2IconBarScrollHint" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>' +
      '</div>'
    );

    layout.appendChild(iconBar);
    layout.appendChild(iconBarScrollHint);
    layout.appendChild(panel);
    layout.appendChild(waveArea);

    // --- ヘッダーのQN Seriesドロップダウン ---
    // QNPLAYER単体先行リリースのため一時無効化。他アプリ公開時にコメントを外せば復活する。
    /*
    const appHeader = document.getElementById("appHeader");
    const appVersion = document.getElementById("appVersion");
    if (appHeader && !document.getElementById("pcV2HeaderNav")) {
      const apps = [
        { name: "QNPLAYER", desc: "Speed/Key変更＆マーカー付き音楽プレイヤー", url: "https://qonny-game.github.io/QN-PLAYER/", current: true },
        { name: "QNPITCH", desc: "リアルタイム音痴度チェッカー", url: "https://qonny-game.github.io/QN-PITCH/" },
        { name: "QNPHRASE", desc: "ギターフレーズ自動生成", url: "https://qonny-game.github.io/QN-PHRASE" },
        { name: "QNTEMPO", desc: "メトロノーム", url: "https://qonny-game.github.io/QN-TEMPO/" },
        { name: "QNTUNER", desc: "マイク入力チューナー", url: "https://qonny-game.github.io/QN-TUNER/" }
      ];
      const nav = el(
        '<div id="pcV2HeaderNav">' +
          '<button type="button" class="pcv2-header-nav-trigger" id="pcV2HeaderNavTrigger" title="QN Series">' +
            '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>' +
          '</button>' +
          '<div class="pcv2-header-nav-dropdown"></div>' +
        '</div>'
      );
      const trigger = nav.querySelector(".pcv2-header-nav-trigger");
      if (appVersion) {
        markAnchor("appVersion", appVersion);
        trigger.insertAdjacentElement("afterend", appVersion);
      }
      const dropdown = nav.querySelector(".pcv2-header-nav-dropdown");
      apps.forEach(app => {
        // ヘッダーロゴ(#appLogoQN)と同じ配色にするため、アプリ名の
        // 先頭"QN"だけ別spanにしてアクセントカラー、残りは白にする。
        const qnPrefix = app.name.slice(0, 2);
        const rest = app.name.slice(2);
        const link = el(
          '<a class="pcv2-header-nav-link' + (app.current ? ' current' : '') + '" href="' + app.url + '" target="_blank" rel="noopener">' +
            '<span class="pcv2-header-nav-link-name"><span class="pcv2-header-nav-link-name-qn">' + qnPrefix + '</span>' + rest + '</span>' +
            '<span class="pcv2-header-nav-link-desc">' + app.desc + '</span>' +
          '</a>'
        );
        dropdown.appendChild(link);
      });
      appHeader.appendChild(nav);
      const dropdownEl = nav.querySelector(".pcv2-header-nav-dropdown");
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = !nav.classList.contains("open");
        nav.classList.toggle("open", willOpen);
        if (willOpen) {
          // 展開後のロゴ一覧が、ページ上部のロゴと縦に揃うよう、
          // ドロップダウンの左端をappLogoの左端に合わせる
          // （#pcV2HeaderNav自体はロゴの右にあるボタンのため、
          // その位置基準のleft:0のままではロゴより右にずれてしまう）。
          const logoEl = document.getElementById("appLogo");
          const navRect = nav.getBoundingClientRect();
          const logoRect = logoEl ? logoEl.getBoundingClientRect() : navRect;
          dropdownEl.style.left = (logoRect.left - navRect.left) + "px";
        }
      });
      document.addEventListener("click", () => nav.classList.remove("open"));
    }
    */

    // --- pcV2Root：3カラム部分(layout)を積む ---
    const root = el('<div id="pcV2Root"></div>');
    root.appendChild(layout);

    // 既存の.app-container(#appHeaderの後)の直後にPC v2骨組みを挿入
    appContainer.parentNode.insertBefore(root, appContainer.nextSibling);

    // アイコンバー右端の「まだ続きがある」ヒント矢印の初期化。
    setupIconBarScrollHint();

    // --- メインエリア（TUNERMODE/PITCHMODEの.player-section）を
    // app-containerから右カラム(#pcV2WaveArea)へ移動する
    // （markAnchorで元位置を記録してから移す）。
    const pitchTunerSection = document.getElementById("pitchTunerSection");
    const pitchPitchSection = document.getElementById("pitchPitchSection");

    markAnchor("pitchTunerSection", pitchTunerSection);
    markAnchor("pitchPitchSection", pitchPitchSection);

    [pitchTunerSection, pitchPitchSection].forEach(elmt => {
      if (elmt) waveArea.appendChild(elmt);
    });

    initPanels();

    // 初期表示：PC幅は常時パネル表示のため、TUNERMODEのTone Generator
    // (control)を開いた状態にする。SP幅は初期状態でパネルが閉じており、
    // メインエリアが見える「mainview」状態がユーザーの実際の見え方と
    // 一致するため、そちらをアクティブにする（QNPLAYERのSeekbar/
    // Libraryと同じ判定ロジック）。
    const isSpWidthInit = window.matchMedia("(max-width: 900px)").matches;
    if (isSpWidthInit) {
      closePanelOverlay();
    } else {
      switchPanel("control");
    }
  }

  // 各パネル種別の中身要素への参照を保持。
  let controlBody, markersBody, playlistBody, textBody, displayBody;

  function initPanels() {
    // #sidebarSection内の各mobile-tab-panelはそのまま(親のsidebarSectionごと)
    // 移動はせず、CSS側で#pcV2PanelBody内に「後から挿入したときだけ」見た目を
    // 常時表示にする。ここでは実体を#pcV2PanelBodyへ移動する。
    controlBody = document.querySelector('.mobile-tab-panel[data-tab-panel="control"]');
    markersBody = document.querySelector('.mobile-tab-panel[data-tab-panel="markers"]');
    playlistBody = document.querySelector('.mobile-tab-panel[data-tab-panel="playlist"]');
    textBody = document.querySelector('.mobile-tab-panel[data-tab-panel="text"]');
    displayBody = document.querySelector('.mobile-tab-panel[data-tab-panel="display"]');

    // SP幅へ戻った時に正しい位置へ差し戻せるよう、まだ元の親にいる
    // うちに目印を残しておく（この時点では実際の移動はまだ行わない）。
    markAnchor("control", controlBody);
    markAnchor("markers", markersBody);
    markAnchor("playlist", playlistBody);
    markAnchor("text", textBody);
    markAnchor("display", displayBody);
  }

  // アイコンバー右端の「まだ続きがある」ヒント矢印。
  // #pcV2IconBarがまだ右方向にスクロールできる間だけ表示し、右端まで
  // スクロールしきったら自動で消える（PC幅ではそもそもスクロールしない
  // レイアウトのため、CSS側で常に非表示にしている＝ここでのdisplay制御は
  // 実質SP幅時のみ意味を持つ）。
  function updateIconBarScrollHint() {
    const iconBar = document.getElementById("pcV2IconBar");
    const hint = document.getElementById("pcV2IconBarScrollHint");
    if (!iconBar || !hint) return;

    // 右方向にあとどれだけスクロールできるか。1pxの誤差（ブラウザや
    // ズーム倍率による端数）を許容し、それ以下なら「もう最後まで見た」
    // とみなす。
    const remaining = iconBar.scrollWidth - iconBar.clientWidth - iconBar.scrollLeft;
    const canScrollMore = remaining > 1;
    hint.classList.toggle("visible", canScrollMore);
  }

  // 初期化：スクロール位置の変化・要素サイズの変化（ボタン増減、
  // ウィンドウリサイズ等）の両方を拾って判定し直す。
  //   scroll: ユーザーが実際に横スクロールした時
  //   resize(window): 画面幅が変わり、PC幅⇔SP幅を跨いだ時
  //   ResizeObserver(iconBar): アイコンバー自体の幅・中身の幅が変わった時
  //     （将来ボタン数が増減した場合や、フォント読み込み後の幅確定など）
  function setupIconBarScrollHint() {
    const iconBar = document.getElementById("pcV2IconBar");
    if (!iconBar) return;

    iconBar.addEventListener("scroll", updateIconBarScrollHint, { passive: true });
    window.addEventListener("resize", updateIconBarScrollHint);

    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(updateIconBarScrollHint);
      ro.observe(iconBar);
    }

    // 初回判定（DOM構築直後は幅が確定しきっていない場合があるため、
    // 次フレームで再判定する）。
    updateIconBarScrollHint();
    requestAnimationFrame(updateIconBarScrollHint);
  }

  function handleIconClick(item) {
    if (typeof hapticTap === "function") hapticTap();

    if (item.panelType === "close") {
      // mainview: パネルを開かず、開いていれば閉じるだけ（TUNERMODE/
      // PITCHMODEのメインエリアが見える基本画面に戻る）。PC幅では
      // パネルは常時表示のクラスを持たないため、closePanelOverlay()を
      // 呼んでも見た目上は何も起きない。
      closePanelOverlay();
      return;
    }

    openPanelOverlay(item.id);
  }

  // SP幅（900px以下）では、パネルはヘッダー直下〜下部バー直上を覆う
  // オーバーレイとして開閉する（#pcV2Layoutの.pcv2-panel-openクラスで
  // CSS側の表示を切り替える。PC幅では常時表示のためこのクラスは
  // 見た目に影響しない）。同じアイコンを再タップしたら閉じる。
  // アイコンバー上段(Tone Generator/Sensitivity/Filters/Recordings、
  // handleIconClick経由)・下段(Keyboard/Color、直接呼び出し)の
  // 両方から呼ばれる共通の入口。
  function openPanelOverlay(panelId) {
    const layoutEl = document.getElementById("pcV2Layout");
    const isSpWidth = window.matchMedia("(max-width: 900px)").matches;
    if (isSpWidth && layoutEl) {
      const alreadyOpen = layoutEl.classList.contains("pcv2-panel-open");
      const isSamePanel = currentPanel === panelId;
      if (alreadyOpen && isSamePanel) {
        closePanelOverlay();
        return;
      }
      layoutEl.classList.add("pcv2-panel-open");
    }

    switchPanel(panelId);
  }

  function closePanelOverlay() {
    const layoutEl = document.getElementById("pcV2Layout");
    if (layoutEl) layoutEl.classList.remove("pcv2-panel-open");

    // パネルを閉じた=メインエリア(mainview)が見える画面がアクティブに
    // なったということなので、内部状態(currentPanel)もアイコンバーの
    // 色もmainviewに揃える（ユーザーの見た目上の認識と、内部の「今どの
    // パネルが選ばれているか」の状態を一致させるため。ここを合わせて
    // おかないと、次に同じアイコンを押した時に「閉じる/開く」の判定
    // (openPanelOverlay内のisSamePanel)がユーザーの体感とズレる）。
    currentPanel = "mainview";
    document.querySelectorAll("#pcV2IconBar .pcv2-icon-item").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-panel-id") === "mainview");
    });
  }

  // 【v1.0.2新設】Save/Rename/Clear確認用の一時パネル。
  // 通常のアイコンバー操作（ICON_ITEMSに登録されたパネル）とは別に、
  // pitch-recordings.js側のボタン操作（SAVE等）から開く「一時的な
  // パネル」。開く直前にどのパネルが表示されていたかを記憶しておき、
  // 閉じたら元のパネルへ自動的に戻す（ユーザーがFiltersパネルを見て
  // いる最中にSAVEを押した場合、閉じたらまたFiltersへ戻るのが自然な
  // ため）。
  let panelBeforeTemporary = null;

  function openTemporaryPanel(panelId) {
    if (panelBeforeTemporary === null) panelBeforeTemporary = currentPanel;
    openPanelOverlay(panelId);
  }

  function closeTemporaryPanel() {
    const isSpWidth = window.matchMedia("(max-width: 900px)").matches;
    const returnTo = panelBeforeTemporary;
    panelBeforeTemporary = null;
    if (isSpWidth) {
      closePanelOverlay();
    } else if (returnTo && returnTo !== "mainview") {
      switchPanel(returnTo);
    } else {
      switchPanel(currentMode === "tuner" ? "control" : "playlist");
    }
  }
  window.QNPitch.openTemporaryPanel = openTemporaryPanel;
  window.QNPitch.closeTemporaryPanel = closeTemporaryPanel;

  // Markers/Libraryパネル共通：画面右下のフローティングアクションボタン群
  // （上段=Add系⇔Delete、下段=EDIT⇔OK、編集モードでCSS表示切替）。
  // panelBody末尾に追加、position:absoluteで右下固定（style-pcv2-panels.css参照）。
  // QNPITCHではAdd系ボタンは使わず、Recordings(text)の複数選択削除UIとしてのみ使う。
  function buildPanelFab(panelId) {
    const fab = el('<div id="pcV2PanelFab"></div>');

    // 上段グループ1：Add系は現状無し（空のまま残す。§0-2参照）。
    const addGroup = el('<div class="pcv2-fab-addgroup"></div>');
    fab.appendChild(addGroup);

    // 上段グループ2：Delete（編集モード中のみ表示）。
    const deleteBtn = el(
      '<button type="button" class="panel-fab-btn panel-fab-delete-btn" id="pcV2DeleteSelectedBtn" disabled>' +
        '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>' +
        '<span>Delete</span>' +
      '</button>'
    );
    deleteBtn.addEventListener("click", () => deleteSelectedItems(panelId));
    fab.appendChild(deleteBtn);

    // 下段：EDIT⇔OK（常時表示）。
    const editBtn = el(
      '<button type="button" class="panel-fab-btn panel-edit-btn" id="pcV2' + (panelId === "text" ? "Recordings" : panelId) + 'EditBtn" title="Edit ' + panelId + '">' +
        '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>' +
        '<span>EDIT</span>' +
      '</button>'
    );
    editBtn.addEventListener("click", () => toggleEditMode(panelId));
    fab.appendChild(editBtn);

    return fab;
  }

  // パネルの中身の退避場所。document.body直下の非表示div。
  function getPanelStash() {
    let stash = document.getElementById("pcV2PanelStash");
    if (!stash) {
      stash = el('<div id="pcV2PanelStash" style="display:none;" aria-hidden="true"></div>');
      document.body.appendChild(stash);
    }
    return stash;
  }

  // panelBody内の再利用する実体（各パネルの中身・QNメニューのセクション）を
  // 退避場所へ移す。FAB等、パネルを開くたびに作り直す使い捨て要素は
  // 対象外（innerHTML=""でそのまま破棄してよい）。
  function stashPanelContents(panelBody) {
    const stash = getPanelStash();
    const keep = [
      controlBody, markersBody, playlistBody, textBody,
      pcv2QnSections.color, pcv2QnSections.keyboard
    ];
    keep.forEach(node => {
      if (node && node.parentNode === panelBody) stash.appendChild(node);
    });
  }

  function switchPanel(panelId) {
    currentPanel = panelId;

    // 現在のパネル以外に切り替えたら編集モードは常にリセットする
    // （QNPITCHではRecordings(text)のみ編集モードを持つ）。
    if (panelId !== "text" && editModeState.text) {
      editModeState.text = false;
    }

    document.querySelectorAll("#pcV2IconBar .pcv2-icon-item").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-panel-id") === panelId);
    });

    const panelBody = document.getElementById("pcV2PanelBody");
    const panelHeader = document.getElementById("pcV2PanelHeader");
    if (!panelBody || !panelHeader) return;

    // 前回の中身を退避してから、今回の中身を挿入する。innerHTML=""で
    // 切り離すと、非表示パネル中の要素がdocumentから消えてgetElementByIdが
    // nullを返し、裏側の描画更新が空振りする不具合があった（QNPLAYER §3-19の
    // 教訓）。#pcV2PanelStash（非表示の退避場所）へ移すことで回避する。
    stashPanelContents(panelBody);
    panelBody.innerHTML = "";
    panelHeader.innerHTML = "";
    // パネル種別ごとのクラス(pcv2-panel-*)だけ入れ替える。
    Array.from(panelBody.classList)
      .filter(c => c.indexOf("pcv2-panel-") === 0)
      .forEach(c => panelBody.classList.remove(c));
    panelBody.classList.add("pcv2-panel-" + panelId);

    if (panelId === "keyboard" || panelId === "color") {
      const titleSpan = el('<span class="pcv2-panel-header-title"></span>');
      titleSpan.textContent = panelId === "keyboard" ? "Keyboard" : "Color";
      panelHeader.appendChild(titleSpan);
      renderQnMenuSectionPanel(panelId, panelBody);
      return;
    }

    // Save/Rename/Clear確認は中央モーダルではなく、Filters/Sensitivityと
    // 同じPanel領域に一時的に表示する方式（v1.0.2）。pitch-recordings.js側の
    // SAVE/RENAME/CLEARボタン操作からopenTemporaryPanel()経由で呼ばれる。
    if (panelId === "save-dialog" || panelId === "rename-dialog" || panelId === "clear-confirm") {
      const titleMap = { "save-dialog": "Save Recording", "rename-dialog": "Rename", "clear-confirm": "Clear Roll?" };
      const titleSpan = el('<span class="pcv2-panel-header-title"></span>');
      titleSpan.textContent = titleMap[panelId];
      panelHeader.appendChild(titleSpan);
      if (typeof window.QNPitch.renderTemporaryPanel === "function") {
        window.QNPitch.renderTemporaryPanel(panelId, panelBody);
      }
      return;
    }

    const item = ICON_ITEMS.find(i => i.id === panelId);
    if (!item) return;

    const titleSpan = el('<span class="pcv2-panel-header-title"></span>');
    titleSpan.textContent = item.label;
    panelHeader.appendChild(titleSpan);

    if (item.panelType === "tab") {
      if (panelId === "control") {
        if (controlBody) panelBody.appendChild(controlBody);
      } else if (panelId === "markers") {
        if (markersBody) panelBody.appendChild(markersBody);
      } else if (panelId === "display") {
        if (displayBody) panelBody.appendChild(displayBody);
      } else if (panelId === "playlist") {
        if (playlistBody) panelBody.appendChild(playlistBody);
      } else if (panelId === "text") {
        if (textBody) panelBody.appendChild(textBody);
        attachDisableGuard("text");
        panelBody.appendChild(buildPanelFab("text"));
      }
      // 既存のタブ状態・関連ロジック（ハイライト等）を呼び出し元と
      // 一致させておく。SP幅の吸着タブ表示には影響しない。
      if (typeof setMobileTab === "function") setMobileTab(panelId);
    }
  }

  // Recordings(text)パネル：Editボタンで削除用チェック(.del-btn)だけの
  // 編集モードをトグルする。編集モード中は.del-btnクリックで選択状態を
  // トグルし、#pcV2DeleteSelectedBtnで選択項目をまとめて削除する
  // （QNPLAYERのMarkers/Playlist編集モードと同じ型。対象はtextのみ）。
  const editModeState = { text: false };
  window.isRecordingsEditMode = () => editModeState.text;
  const selectedIndices = { text: new Set() };
  window.recordingsHasSelectedItems = () => selectedIndices.text.size > 0;

  function toggleEditMode(panelId) {
    if (!(panelId in editModeState)) return;
    editModeState[panelId] = !editModeState[panelId];
    selectedIndices[panelId].clear();

    const panelBody = document.getElementById("pcV2PanelBody");
    const editBtnId = "pcV2RecordingsEditBtn";
    const editBtn = document.getElementById(editBtnId);
    const deleteBtn = document.getElementById("pcV2DeleteSelectedBtn");
    const fab = document.getElementById("pcV2PanelFab");
    const addGroup = fab ? fab.querySelector(".pcv2-fab-addgroup") : null;
    const cssClass = panelId + "-edit-mode";
    if (panelBody) panelBody.classList.toggle(cssClass, editModeState[panelId]);
    if (editBtn) {
      editBtn.classList.toggle("active", editModeState[panelId]);
      const editBtnLabel = editBtn.querySelector("span");
      if (editBtnLabel) editBtnLabel.textContent = editModeState[panelId] ? "OK" : "EDIT";
    }
    // 上段：編集モード中はAdd系を隠してDeleteを表示、通常時はその逆
    // （新規追加と削除選択を同時に操作できてしまうと紛らわしいための
    // 排他表示）。
    if (addGroup) {
      addGroup.style.display = editModeState[panelId] ? "none" : "flex";
    }
    if (deleteBtn) {
      deleteBtn.style.display = editModeState[panelId] ? "flex" : "none";
      deleteBtn.disabled = true;
    }

    // 編集モードの切り替えでリスト側のDOM構造自体(チェックボックスの
    // 有無等)が変わるため、対象のrender関数を呼び直して作り直す。
    if (panelId === "text" && window.QNPitch && window.QNPitch.recordings && typeof window.QNPitch.recordings.refreshRecList === "function") {
      window.QNPitch.recordings.refreshRecList();
    }

    if (editModeState[panelId]) {
      attachSelectionHandlers(panelId);
    } else {
      clearSelectionVisuals(panelId);
    }
  }

  // 通常時(編集モードOFF)はチェックボックス選択用の要素だけを無効化する。
  const disableHandlers = { text: null };

  function attachDisableGuard(panelId) {
    const container = getListContainer(panelId);
    if (!container || disableHandlers[panelId]) return;
    const handler = (e) => {
      if (editModeState[panelId]) return;
      return;
    };
    container.addEventListener("click", handler, true);
    disableHandlers[panelId] = handler;
  }

  function getListContainer(panelId) {
    return document.getElementById("pitchRecListScroll");
  }

  function getRowItems(panelId) {
    const container = getListContainer(panelId);
    if (!container) return [];
    return Array.from(container.children);
  }

  // .del-btnクリックを編集モード中は選択トグルとして扱う
  // （QNPLAYERのMarkers/Playlist選択機構をRecordings用に単純化）。
  const selectionHandlers = { text: null };

  function attachSelectionHandlers(panelId) {
    const container = getListContainer(panelId);
    if (!container) return;
    if (selectionHandlers[panelId]) {
      container.removeEventListener("click", selectionHandlers[panelId], true);
    }
    const handler = (e) => {
      const delBtn = e.target.closest(".del-btn");
      if (!delBtn || !container.contains(delBtn)) return;
      e.stopPropagation();
      e.preventDefault();
      const items = getRowItems(panelId);
      const row = delBtn.closest(".pitch-rec-row");
      const index = items.indexOf(row);
      if (index === -1) return;
      if (selectedIndices[panelId].has(index)) {
        selectedIndices[panelId].delete(index);
        delBtn.classList.remove("pcv2-selected");
      } else {
        selectedIndices[panelId].add(index);
        delBtn.classList.add("pcv2-selected");
      }
      const deleteBtn = document.getElementById("pcV2DeleteSelectedBtn");
      if (deleteBtn) deleteBtn.disabled = selectedIndices[panelId].size === 0;
    };
    container.addEventListener("click", handler, true);
    selectionHandlers[panelId] = handler;
  }

  function clearSelectionVisuals(panelId) {
    const container = getListContainer(panelId);
    if (container) {
      container.querySelectorAll(".del-btn.pcv2-selected").forEach(b => b.classList.remove("pcv2-selected"));
      if (selectionHandlers[panelId]) {
        container.removeEventListener("click", selectionHandlers[panelId], true);
        selectionHandlers[panelId] = null;
      }
    }
    selectedIndices[panelId].clear();
  }

  function deleteSelectedItems(panelId) {
    const indices = Array.from(selectedIndices[panelId]).sort((a, b) => b - a);
    if (indices.length === 0) return;
    if (typeof hapticWarning === "function") hapticWarning();

    // 選択中の行にフェードアウト演出を掛けてから、実際のデータ削除・
    // リスト再描画を行う（QNPLAYERと同じ演出。削除中は操作不能にする）。
    const deleteBtn = document.getElementById("pcV2DeleteSelectedBtn");
    if (deleteBtn) deleteBtn.disabled = true;

    const container = getListContainer(panelId);
    const items = getRowItems(panelId);
    const fadingEls = indices.map(i => items[i]).filter(Boolean);
    const FADE_MS = 260;

    if (container) container.style.pointerEvents = "none";
    fadingEls.forEach(el => el.classList.add("pcv2-row-deleting"));

    setTimeout(() => {
      if (container) container.style.pointerEvents = "";
      performDelete(panelId, indices);
    }, fadingEls.length > 0 ? FADE_MS : 0);
  }

  // deleteSelectedItems()からフェードアウト分の待機を挟んで呼ばれる、
  // 実際のデータ削除本体。QNPITCHではtext(Recordings)のみ対象。
  async function performDelete(panelId, indices) {
    if (panelId !== "text") return;
    const rec = window.QNPitch && window.QNPitch.recordings;
    if (!rec) return;
    const container = getListContainer(panelId);
    const items = container ? Array.from(container.children) : [];
    for (const i of indices) {
      const row = items[i];
      const id = row ? Number(row.dataset.recordingId) : null;
      if (id !== null && !Number.isNaN(id)) {
        await rec.dbDeleteRecording(id);
      }
    }
    editModeState.text = false;
    selectedIndices.text.clear();
    if (typeof rec.refreshRecList === "function") rec.refreshRecList();
  }

  // Keyboard/Colorパネル：#qnMenuMount内（player-theme.js/style-theme.css
  // が担当）のTheme(Color)/Shortcuts(Keyboard)セクションを、DOMごと
  // パネルへ移動して表示する。player-theme.js自体のロジック(テーマ切替・
  // Glowトグル・ショートカット表生成)には一切手を入れない。
  // 一度移動したセクションはpcv2QnSectionsに保持し、パネルを行き来しても
  // 同じ要素（イベントハンドラ・状態を保ったまま）を再利用する。
  const pcv2QnSections = { keyboard: null, color: null };

  function qnSectionSelector(panelId) {
    return panelId === "keyboard"
      ? '.qn-menu-section[data-qn-section="shortcuts"]'
      : '.qn-menu-section[data-qn-section="theme"]';
  }

  function tryClaimQnSections() {
    const mount = document.getElementById("qnMenuMount");
    if (!mount) return;
    if (!pcv2QnSections.keyboard) {
      const el2 = mount.querySelector(qnSectionSelector("keyboard"));
      if (el2) pcv2QnSections.keyboard = el2;
    }
    if (!pcv2QnSections.color) {
      const el2 = mount.querySelector(qnSectionSelector("color"));
      if (el2) pcv2QnSections.color = el2;
    }
  }

  function renderQnMenuSectionPanel(panelId, panelBody) {
    // 既に確保済みならそのまま差し込むだけ。
    if (pcv2QnSections[panelId]) {
      panelBody.appendChild(pcv2QnSections[panelId]);
      return;
    }

    tryClaimQnSections();
    if (pcv2QnSections[panelId]) {
      panelBody.appendChild(pcv2QnSections[panelId]);
      return;
    }

    // #qnMenuMount内にセクションが見つからない場合（index.html側の
    // マークアップが壊れている等、通常は起こらない異常系）のみ、
    // エラー表示に留める。
    panelBody.appendChild(el('<div class="pcv2-qn-loading">読み込みに失敗しました。再読み込みしてお試しください。</div>'));
  }

  // 元の位置に戻すための目印（コメントノード）。要素移動前に元の場所へ
  // 目印を挿入しておき、SP幅へ戻る際はその目印の直前に要素を差し戻す。
  const anchors = {};

  function markAnchor(key, elmt) {
    if (!elmt || !elmt.parentNode) return;
    const anchor = document.createComment("pcv2-anchor-" + key);
    elmt.parentNode.insertBefore(anchor, elmt);
    anchors[key] = anchor;
  }

  function restoreAnchor(key, elmt) {
    const anchor = anchors[key];
    if (anchor && anchor.parentNode && elmt) {
      anchor.parentNode.insertBefore(elmt, anchor);
      anchor.parentNode.removeChild(anchor);
      delete anchors[key];
    }
  }

  function activate() {
    build();
    document.body.classList.add("pc-v2-active");
    document.documentElement.classList.add("pc-v2-active-html");
  }

  // 【QNPLAYERとの相違点】QNPITCHはPC v2を画面幅を問わず常時有効化する
  // （QNPLAYERと同じ設計。§0-2参照）ため、deactivate()が実際に呼ばれる
  // 場面は実質無い。型は保険として残すが、中身はQNPITCHの実際の要素
  // 参照に合わせてある。
  function deactivate() {
    document.body.classList.remove("pc-v2-active");
    document.documentElement.classList.remove("pc-v2-active-html");
    if (!built) return;

    // メインエリア一式・各パネル中身を、build()時に記録した元の位置へ戻す。
    restoreAnchor("pitchTunerSection", document.getElementById("pitchTunerSection"));
    restoreAnchor("pitchPitchSection", document.getElementById("pitchPitchSection"));
    restoreAnchor("control", controlBody);
    restoreAnchor("markers", markersBody);
    restoreAnchor("playlist", playlistBody);
    restoreAnchor("text", textBody);

    // Keyboard/Colorパネルへ移動していたセクションを、元の#qnMenuMount
    // へ戻す（theme→shortcutsの順、index.html側の元の並び順を保つ）。
    if (pcv2QnSections.color || pcv2QnSections.keyboard) {
      const mount = document.getElementById("qnMenuMount");
      if (mount) {
        if (pcv2QnSections.color) {
          mount.insertBefore(pcv2QnSections.color, mount.firstChild);
        }
        if (pcv2QnSections.keyboard) {
          mount.appendChild(pcv2QnSections.keyboard);
        }
      }
      pcv2QnSections.color = null;
      pcv2QnSections.keyboard = null;
    }

    const layout = document.getElementById("pcV2Root");
    if (layout) layout.parentNode.removeChild(layout);
    built = false;
  }

  function sync() {
    if (mql.matches) {
      activate();
    } else {
      deactivate();
    }
  }

  // ============================================================
  // MODE切替（TUNERMODE / PITCHMODE）。QNPLAYERには無い、QNPITCH固有の
  // 概念。ヘッダー右の#pitchModeToggleボタンから呼ばれる。
  // §0-2参照：将来「PLAYER/TUNER/PITCH」の3モード切替に拡張されうる
  // 前提の実装にしてある。
  // ============================================================
  function setMode(mode) {
    if (mode === currentMode) return;
    const prevMode = currentMode;

    // モードを離れる各機能ファイルへ通知する（マイク停止等の後片付け）。
    window.dispatchEvent(new CustomEvent("qnpitch-mode-change", { detail: { from: prevMode, to: mode } }));

    currentMode = mode;

    document.querySelectorAll(".pitch-mode-btn").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
    });

    const tunerSection = document.getElementById("pitchTunerSection");
    const pitchSection = document.getElementById("pitchPitchSection");
    if (tunerSection) tunerSection.hidden = mode !== "tuner";
    if (pitchSection) pitchSection.hidden = mode !== "pitch";

    // アイコンバーをこのモード用の項目に再構築する。
    const iconBar = document.getElementById("pcV2IconBar");
    if (iconBar) renderIconBarItems(iconBar);

    // 【重要】closePanelOverlay()はcurrentPanelを"mainview"にするだけで
    // パネルの中身を差し替えない（QNPLAYERの元設計では、SP幅の
    // オーバーレイを閉じる操作＝パネル自体は既に表示されたままの状態
    // で"mainview"扱いにするだけで良かったため）。QNPITCHはモード
    // 切替のたびにパネルの中身自体（Tone Generator→Filters等）を
    // 差し替える必要があるため、この時点で新モードの最初のパネルを
    // 明示的に開き直す。
    const isSpWidth = window.matchMedia("(max-width: 900px)").matches;
    if (isSpWidth) {
      closePanelOverlay();
    } else {
      switchPanel(mode === "tuner" ? "control" : "playlist");
    }

    // ヘッダーのマイクボタンの見た目を、新モードの実際の状態に同期させる。
    const micBtn = document.getElementById("pitchHeaderMicBtn");
    if (micBtn) {
      const isOn = mode === "tuner"
        ? !!(window.QNPitch.tunerMode && window.QNPitch.tunerMode.isMicRunning())
        : !!(window.QNPitch.pitchMode && window.QNPitch.pitchMode.isRecording());
      micBtn.classList.toggle("mic-on", isOn);
    }
  }
  window.QNPitch = window.QNPitch || {};
  window.QNPitch.setMode = setMode;
  window.QNPitch.getMode = () => currentMode;

  function setupModeToggle() {
    document.querySelectorAll(".pitch-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => setMode(btn.getAttribute("data-mode")));
    });
  }

  // ============================================================
  // ヘッダーのマイクON/OFFボタン（共通部分）。
  // TUNERMODEのMic Tuner起動/停止と、PITCHMODEの録音(REC)開始/停止を、
  // 現在開いているモードに応じてこのボタン1つで制御する。
  // ============================================================
  function setupHeaderMicButton() {
    const btn = document.getElementById("pitchHeaderMicBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (currentMode === "tuner") {
        const tunerMode = window.QNPitch.tunerMode;
        if (!tunerMode) return;
        if (tunerMode.isMicRunning()) tunerMode.stopMic();
        else tunerMode.startMic();
      } else if (currentMode === "pitch") {
        const pitchMode = window.QNPitch.pitchMode;
        if (!pitchMode) return;
        if (pitchMode.isRecording()) pitchMode.stopRecording();
        else pitchMode.startRecording();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sync);
  } else {
    sync();
  }
  mql.addEventListener("change", sync);

  if (document.readyState === "complete") {
    setupModeToggle();
    setupHeaderMicButton();
  } else {
    window.addEventListener("load", () => {
      setupModeToggle();
      setupHeaderMicButton();
    });
  }

})();
