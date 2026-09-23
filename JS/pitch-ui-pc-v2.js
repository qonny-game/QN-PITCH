// ============================================================
// pitch-ui-pc-v2.js
// QNPITCH PC v2シェル：左アイコンバー＋中央パネル＋右メインウインドウの
// 3カラムレイアウト（SP幅ではCSS側の@media(max-width:900px)で
// 縦積み・オーバーレイパネルに切り替える。DOM構造・JSロジックは
// PC/SP共通）。
//
// 【設計方針】md/AI_ASSISTANT_PROJECT_CONTEXT.md §0-2参照。
// QNPLAYERのplayer-ui-pc-v2.js（2194行）は、中身の大半がプレイリスト・
// マーカー・Speed/Key/EQ等のPLAYER固有トランスポートをPC v2レイアウト
// へ配置するロジックだったため、丸ごとコピーしていない。以下の「型」
// だけを踏襲し、中身はQNPITCH用に書き直している：
//   - ICON_ITEMS配列でアイコンバーの項目を定義し、クリックで対応パネル
//     を開閉する仕組み（QNPLAYERのpanelType:"tab"相当）
//   - #pcV2Layout > #pcV2IconBar + #pcV2Panel(#pcV2PanelHeader+
//     #pcV2PanelBody) + #pcV2WaveArea というDOM骨格と、CSS側の
//     @media(max-width:900px)によるSP/PC自動レイアウト切り替え
//   - built フラグによる一度きりのbuild()実行
//
// 【QNPLAYERとの相違点】QNPITCHは各パネルの中身を、QNPLAYERのように
// 既存DOM（.mobile-tab-panel）から「移動」させるのではなく、最初から
// このファイル側でパネルごとのレンダー関数を持たせるシンプルな設計に
// している（QNPITCHには「SP専用の旧UI」のような移植元が存在しない
// ため、QNPLAYERのmarkAnchor/restoreAnchorに相当する複雑さは不要）。
// 各パネルの中身のレンダリングは、pitch-mode-tuner.js /
// pitch-mode-pitch.js / pitch-filters.js 等、機能ごとのファイルが
// window.QNPitch.panels.register("<panelId>", { render, activate,
// deactivate }) の形で登録する（下記§ パネル登録の仕組み 参照）。
//
// 依存：pitch-core.js より後に読み込むこと。
// ============================================================

window.QNPitch = window.QNPitch || {};

(function () {
  const PC_BREAKPOINT = "(min-width: 0px)";
  const mql = window.matchMedia(PC_BREAKPOINT);

  let built = false;
  let currentPanel = "mainview";
  let currentMode = "tuner"; // "tuner" | "pitch"

  // ============================================================
  // パネル登録の仕組み。
  // 各機能ファイルが自分のパネルをここに登録する。
  //   window.QNPitch.panels.register("filters", {
  //     label: "Filters", icon: "<path .../>",
  //     modes: ["pitch"],              // どのMODEで表示するアイコンか
  //     render(panelBodyEl) { ... },   // パネルを開いた時に呼ばれる
  //     onClose(panelBodyEl) { }       // パネルを閉じる時（任意）
  //   });
  // ============================================================
  const registeredPanels = {};
  window.QNPitch.panels = {
    register(id, def) {
      registeredPanels[id] = def;
      if (built) rebuildIconBar();
    }
  };

  // メインウインドウ（TUNERMODE/PITCHMODEの常時表示）の登録の仕組み。
  //   window.QNPitch.mainView.register("tuner", { render, onModeEnter, onModeLeave });
  const registeredMainViews = {};
  window.QNPitch.mainView = {
    register(mode, def) {
      registeredMainViews[mode] = def;
    }
  };

  // 下部バー（常用トランスポート）の登録の仕組み。
  //   window.QNPitch.bottomBar.register("tuner", { render });
  const registeredBottomBars = {};
  window.QNPitch.bottomBar = {
    register(mode, def) {
      registeredBottomBars[mode] = def;
    }
  };

  function el(html) {
    const div = document.createElement("div");
    div.innerHTML = html.trim();
    return div.firstChild;
  }

  function iconItemsForCurrentMode() {
    return Object.keys(registeredPanels)
      .map(id => Object.assign({ id }, registeredPanels[id]))
      .filter(item => !item.modes || item.modes.includes(currentMode));
  }

  function build() {
    if (built) return;
    built = true;

    const root = el('<div id="pcV2Root"></div>');
    const layout = el('<div id="pcV2Layout"></div>');
    const iconBar = el('<div id="pcV2IconBar"></div>');
    const iconBarScrollHint = el(
      '<div id="pcV2IconBarScrollHint" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>' +
      '</div>'
    );
    const panel = el('<div id="pcV2Panel"></div>');
    const panelHeader = el('<div id="pcV2PanelHeader"></div>');
    const panelBody = el('<div id="pcV2PanelBody"></div>');
    const panelStash = el('<div id="pcV2PanelStash"></div>');
    const waveArea = el('<div id="pcV2WaveArea"></div>');
    const bottomBar = el('<div id="pcV2BottomBar"></div>');

    panel.appendChild(panelHeader);
    panel.appendChild(panelBody);

    layout.appendChild(iconBar);
    layout.appendChild(iconBarScrollHint);
    layout.appendChild(panel);
    layout.appendChild(waveArea);

    root.appendChild(layout);
    root.appendChild(bottomBar);

    document.body.appendChild(panelStash);
    document.body.appendChild(root);

    renderIconBar();
    renderMainView();
    renderBottomBar();

    setupIconBarScrollHint();
    window.addEventListener("resize", () => {
      updateIconBarScrollHint();
      if (document.getElementById("pcV2Layout")?.classList.contains("pcv2-panel-open")) {
        updatePcv2BottomBarsHeightVar();
      }
    });

    document.addEventListener("click", (e) => {
      const layoutEl = document.getElementById("pcV2Layout");
      if (!layoutEl || !layoutEl.classList.contains("pcv2-panel-open")) return;
      if (panel.contains(e.target) || iconBar.contains(e.target)) return;
      closePanelOverlay();
    });
  }

  function renderIconBar() {
    const iconBar = document.getElementById("pcV2IconBar");
    if (!iconBar) return;
    iconBar.innerHTML = "";

    // 「メインウインドウへ戻る」ショートカット（SP幅専用、PC幅では
    // CSS側で非表示）。QNPLAYERのSeekbarアイコンに相当。
    const mainViewBtn = el(
      '<button type="button" class="pcv2-icon-item" data-panel-id="mainview" title="Back">' +
        '<svg viewBox="0 0 24 24"><path d="M4 5h2v14H4zm4 3h2v8H8zm4-6h2v20h-2zm4 4h2v12h-2zm4 3h2v6h-2z"/></svg>' +
        '<span>View</span>' +
      '</button>'
    );
    mainViewBtn.addEventListener("click", () => closePanelOverlay());
    iconBar.appendChild(mainViewBtn);

    iconItemsForCurrentMode().forEach(item => {
      const btn = el(
        '<button type="button" class="pcv2-icon-item" data-panel-id="' + item.id + '" title="' + item.label + '">' +
          '<svg viewBox="0 0 24 24">' + item.icon + '</svg>' +
          '<span>' + item.label + '</span>' +
        '</button>'
      );
      btn.addEventListener("click", () => openPanelOverlay(item.id));
      iconBar.appendChild(btn);
    });
  }

  function rebuildIconBar() {
    renderIconBar();
  }

  function renderMainView() {
    const waveArea = document.getElementById("pcV2WaveArea");
    if (!waveArea) return;
    const def = registeredMainViews[currentMode];
    waveArea.innerHTML = "";
    if (def && typeof def.render === "function") {
      def.render(waveArea);
    }
  }

  function renderBottomBar() {
    const bottomBar = document.getElementById("pcV2BottomBar");
    if (!bottomBar) return;
    const def = registeredBottomBars[currentMode];
    bottomBar.innerHTML = "";
    if (def && typeof def.render === "function") {
      def.render(bottomBar);
    }
  }

  // ============================================================
  // MODE切替（TUNERMODE / PITCHMODE）。ヘッダー右の#pitchModeToggle
  // ボタンから呼ばれる。
  // ============================================================
  function setMode(mode) {
    if (mode === currentMode) return;
    const prevDef = registeredMainViews[currentMode];
    if (prevDef && typeof prevDef.onModeLeave === "function") prevDef.onModeLeave();

    currentMode = mode;
    closePanelOverlay();
    renderIconBar();
    renderMainView();
    renderBottomBar();

    document.querySelectorAll(".pitch-mode-btn").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
    });

    const nextDef = registeredMainViews[currentMode];
    if (nextDef && typeof nextDef.onModeEnter === "function") nextDef.onModeEnter();
  }
  window.QNPitch.setMode = setMode;
  window.QNPitch.getMode = () => currentMode;

  // ============================================================
  // パネル開閉。SP幅（900px以下）ではヘッダー直下〜下部バー直上を
  // 覆うオーバーレイとして開閉する（#pcV2Layoutの.pcv2-panel-open
  // クラスでCSS側の表示を切り替える）。PC幅では常時表示のため
  // このクラスは見た目に影響しない。同じアイコンを再タップしたら
  // 閉じる（QNPLAYERと同じ型）。
  // ============================================================
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
      updatePcv2BottomBarsHeightVar();
      layoutEl.classList.add("pcv2-panel-open");
    }
    switchPanel(panelId);
  }

  function updatePcv2BottomBarsHeightVar() {
    const layoutEl = document.getElementById("pcV2Layout");
    const bottomBar = document.getElementById("pcV2BottomBar");
    const iconBar = document.getElementById("pcV2IconBar");
    if (!layoutEl || !bottomBar || !iconBar) return;
    const total = bottomBar.getBoundingClientRect().height + iconBar.getBoundingClientRect().height;
    layoutEl.style.setProperty("--pcv2-bottom-bars-height", total + "px");
  }

  function closePanelOverlay() {
    const layoutEl = document.getElementById("pcV2Layout");
    if (layoutEl) layoutEl.classList.remove("pcv2-panel-open");
    switchPanel("mainview");
  }

  // パネル切替時、前回のパネル中身をdocument内の退避場所
  // (#pcV2PanelStash)へ移す。innerHTML=""で切り離すと、非表示パネルの
  // 更新が空振りする問題が起きうるため（QNPLAYER §3-19の教訓を
  // QNPITCHでも最初から踏襲。詳細はAI_ASSISTANT_PROJECT_CONTEXT.md
  // §5参照）、必ずこの退避経路を通す。
  function switchPanel(panelId) {
    const panelBody = document.getElementById("pcV2PanelBody");
    const panelHeader = document.getElementById("pcV2PanelHeader");
    const panelStash = document.getElementById("pcV2PanelStash");
    if (!panelBody || !panelHeader) return;

    const prevItem = registeredPanels[currentPanel];
    if (prevItem && typeof prevItem.onClose === "function") {
      prevItem.onClose(panelBody);
    }
    if (panelStash && panelBody.firstChild) {
      while (panelBody.firstChild) panelStash.appendChild(panelBody.firstChild);
    }

    currentPanel = panelId;
    document.querySelectorAll("#pcV2IconBar .pcv2-icon-item").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-panel-id") === panelId);
    });

    panelHeader.innerHTML = "";

    if (panelId === "mainview") return;

    const item = registeredPanels[panelId];
    if (!item) return;

    const titleSpan = el('<span class="pcv2-panel-header-title"></span>');
    titleSpan.textContent = item.label;
    panelHeader.appendChild(titleSpan);

    if (typeof item.render === "function") {
      item.render(panelBody);
    }
  }
  window.QNPitch.openPanel = openPanelOverlay;
  window.QNPitch.closePanel = closePanelOverlay;

  // ============================================================
  // アイコンバー右端の「まだ続きがある」ヒント矢印（SP幅専用）。
  // QNPLAYERと同じ型。
  // ============================================================
  function updateIconBarScrollHint() {
    const iconBar = document.getElementById("pcV2IconBar");
    const hint = document.getElementById("pcV2IconBarScrollHint");
    if (!iconBar || !hint) return;
    const remaining = iconBar.scrollWidth - iconBar.clientWidth - iconBar.scrollLeft;
    hint.classList.toggle("visible", remaining > 4);
  }

  function setupIconBarScrollHint() {
    const iconBar = document.getElementById("pcV2IconBar");
    if (!iconBar) return;
    iconBar.addEventListener("scroll", updateIconBarScrollHint, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(updateIconBarScrollHint);
      ro.observe(iconBar);
    }
    updateIconBarScrollHint();
    requestAnimationFrame(updateIconBarScrollHint);
  }

  // ============================================================
  // 起動。
  // 【重要】このファイルは他の機能ファイル（pitch-mode-tuner.js等）
  // より前にindex.htmlで読み込まれるが、それらのファイルは自分の
  // トップレベルコードでwindow.QNPitch.panels.register()等を呼ぶ
  // ため、build()（＝renderIconBar/renderMainView実行）はそれらの
  // register呼び出しが全て完了した後でなければならない。
  // 全<script>タグの同期実行が終わったタイミング＝window.load
  // イベントを待つことで、後続ファイルの登録漏れを防ぐ
  // （DOMContentLoadedの時点でも、<body>末尾のscriptは実行順が
  // 保証されるため理論上は間に合うが、将来asyncやdeferを使う
  // scriptが混じった場合の事故を避けるため、より確実なloadを使う）。
  // ============================================================
  function activate() {
    build();
    document.body.classList.add("pc-v2-active");
    document.documentElement.classList.add("pc-v2-active-html");
  }

  function init() {
    activate();

    const modeBtns = document.querySelectorAll(".pitch-mode-btn");
    modeBtns.forEach(btn => {
      btn.addEventListener("click", () => setMode(btn.getAttribute("data-mode")));
    });
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();
