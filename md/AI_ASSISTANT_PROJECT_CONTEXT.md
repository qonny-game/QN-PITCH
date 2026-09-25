# QNPITCH プロジェクトコンテキスト & AI協業ガイド

QNPITCH（QNシリーズの「チューナー＋ピッチ検出」統合ブラウザアプリ。
旧QNTUNER + 旧QNPITCHを1本に統合したアプリ）の開発を効率よく進める
ための、プロジェクト固有の知識をまとめたドキュメント。修正依頼の前に
該当セクションを確認することで、同じ調査・同じ失敗を繰り返さない
ようにする。

**現在のステータス：v1.0.5。TUNERMODE（Mic Tuner・Tone Generator・
Sensitivity・Display）・PITCHMODE（ピッチロール・REC/Play/Save/Clear・
フィルタ・Recordings一覧）の基本機能が動作する状態。直近のセッションは
トークン消費を抑えるため、動作確認（プレビュー生成・構文チェック・
スクリーンショット）を行わず「コード修正→ZIP納品」のみで進めている。
次のセッションもこの進め方を継続すること（別途指示があるまで）。**

---

## 0-0.【v1.0.5】未使用コードの掃除（QNPLAYER完全コピー由来のデッドコード削除）

機能が一通り揃った段階で、ユーザー指示によりQNPLAYER完全コピー方針
（§0-2）で持ち込んだものの実際には使っていないコードを削除した。
「次のQNシリーズでもレイアウトを使い回したい」という要望を踏まえ、
**骨組み（`.app-container`/`.control-card`/パネル構造/アイコンバー/
テーマ機構等）は一切崩さず、QNPLAYER固有の曲再生パーツ（実体のない
飾り）だけを削除**する方針で進めた。

削除した主なもの：
- `style-core.css`：`#appTitle`マーキー、`#timeDisplay`、
  `.top-controls`/`.tripleNavBtn`（前の曲/次の曲）、`.av-toggle-btn`
  （VOL/SPEED/KEY/EQ/Export行）、`.vbar`系（波形バー・マーカー）、
  `.segmentHighlight`（ループ区間）を削除（1346→883行）
- `style-layout-pc-v2.css`：`#pcV2BottomBar`関連の全CSS（v1.0.3で
  JS生成自体は削除済みだったのに、対応CSSが広範囲に残存していた）、
  `#pcV2TimeRow`、`#pcV2WaveFabRow`、`.pcv2-anchor-tab`等を削除
  （1500→641行）。未使用CSS変数`--pcv2-wave-fab-space`/
  `--pcv2-bottom-bars-height`は固定値に置き換え
- `style-pcv2-panels.css`：`.pcv2-panel-backup`/`.pcv2-panel-import`
  （QNPLAYERのバックアップ機能、QNPITCHには存在しない）、
  `.pcv2-eq-*`（EQパネル見出し）を削除（911→582行）
- `style-recordings.css`：中央モーダル本体`.export-modal-overlay`/
  `.export-modal`/`.export-modal-header`/`.export-modal-close`
  （v1.0.2でパネル方式に変更済みで不要）を削除（334→253行）
- `style-theme.css`：`.qn-marker-preset-*`（マーカー機能のプリセット
  カラー設定UI、QNPITCHには存在しない）を削除
- `style-mode-pitch.css`：削除済みタイトル`#pitchPitchTitle`のCSS、
  および**v1.0.2時点で「JS側にまだ残っている」前提で書かれていた
  `#pcV2BottomBar`高さ0化CSS**（v1.0.3でJS実体が消えていたため
  この時点でも既にデッドだった）を削除
- `pitch-ui-pc-v2.js`：未使用の`renderBottomBar`関数、常に早期
  リターンしていた`updatePcv2BottomBarsHeightVar`関数（と
  resizeイベントリスナー）を削除。**あわせて、`setMode()`内に
  残っていた`renderBottomBar(bottomBar)`という削除済み関数への
  呼び出し1箇所を発見・削除**（これを見落としたままだと次回
  モード切替時に未定義関数エラーで実行時クラッシュしていた箇所）

削除判断の基準：HTML/JSのどこにも対応する実DOM要素・呼び出しが
存在しない（`grep`で確認、コメント内の言及のみを除く）ことを
確認したもののみを削除対象とした。一方、`.control-card`・パネル
構造・アイコンバー・`#pcV2HeaderNav`（QN Series切替）・認証UIの
課金関連プレースホルダ（`userPlanRemainingRow`等、未実装だが
将来使う予定）は、コード内コメントで「PC v2のJSが構造の前提として
必要としている」旨が明記されていたため、または次シリーズでも
共通して使う骨組みのため削除せずに残した。同様に`pitch-ui-shared.js`
の`hapticTick`/`hapticSuccess`（現状未使用だが「今後の新規QNアプリ
でも踏襲する標準実装ルール」とコメントされている）も型として残した。

作業後、全JSファイルを`node --check`で構文チェック、全CSSファイルの
波括弧対応をPythonスクリプトで検証、`getElementById`参照と実際の
id定義の突き合わせチェックを実施し、いずれも問題ないことを確認した。

## 0-0-1.【v1.0.5】コード内コメントの圧縮（mdとの重複整理）

上記のコード削除に続けて、`pitch-ui-pc-v2.js`を中心にコメント比率が
高すぎた箇所（バグ修正の経緯・教訓を長文で説明しているもの）を整理した。
**このmdファイルの§2「最重要の設計事実」・§3「バグ修正履歴」に既に
詳しく書かれている内容は、コード側では「md §2-6参照」のように一言
参照する形に圧縮し、二重管理を避ける**方針にした。

あわせて、掃除の過程で「もう存在しない要素（`#pcV2BottomBar`・
`#pcV2TimeRow`・`#topControls`等）について説明しているだけの、
実質的に不正確なコメント」がいくつか見つかったため、そちらも削除・
修正した（コードの現状と食い違うコメントは削除・整理対象そのもの
という教訓）。

一方、Firestoreのデータ構造の仕様説明（`pitch-auth.js`の
`unlockUntil`/`planType`/`cancelAtPeriodEnd`まわり）のように、
**コードだけからは読み取れず、未実装の課金ロジックを将来実装する
際に必要になる情報**は、コメントが長くても圧縮せずそのまま残した。
圧縮の基準は「行数」ではなく「その情報がmd等どこか他で読めるか」
「今後もコードを読むだけで分かる情報か」で判断すること。

## 0-0-2.【v1.0.5】CSS側のコメント圧縮・追加のデッドコード発見

上記のJS/mdの整理に続けてCSS側も同じ基準で見直した結果、**前回
（0-0節）の自動チェックが見落としていたデッドコードが複数見つかった**。
主な原因は、それらが「コメント内だけの言及」ではなく「他のCSSファイル
内にセレクタとして実在していた」ため、単純な文字列検索では
「使われている」と誤判定されていたこと。

- `style-core.css`：`#appTitle`/`#appTitleInner`/`#appTitleText`
  （曲名マーキー表示、約50行）が、前回削除した大ブロック
  （533〜999行目相当）の**外側**に独立して残っていた。実DOM要素は
  index.html/JSのどこにも無いことを再確認し削除。
- `style-pcv2-panels.css`：`#pinList`/`#playlistBox`
  （QNPLAYERのマーカー一覧・プレイリスト一覧、約126行）に紐づく
  `markers-edit-mode`/`playlist-edit-mode`編集モードCSS一式。
  JS側（`pitch-ui-pc-v2.js`）ではこの2クラスを`classList.remove()`
  する処理しか無く、付与する処理が存在しないため、対応するCSSは
  完全にデッドだった（JS側のremove処理自体は無害なので残した）。
- 上記2件のような「別ファイルに実体があるように見えて実は無い」
  デッドコードを見つけるには、**単純なgrep一致ではなく、対応する
  実DOM要素・JS処理が本当に存在するかまで確認する**必要がある。
  次に掃除する際もこの点に注意すること。

あわせて、既に削除済みの要素（`#pcV2BottomBar`等）を前提とした
古い経緯説明コメントや、QNPLAYER側にしか存在しないファイル名
（`style-export.css`・`style-control-eq.css`・`player-core.js`・
`CSS_SPLIT_INSTRUCTIONS.md`等）への言及、`style-layout-pc-v2.css`
冒頭で完全に重複していた説明コメント（コピー時の重複ミス）も
整理した。

## 0-0-3.【v1.0.5】CSS↔JS/HTMLのペア照合による追加デッドコード除去

0-0-2の続きとして、「CSSセレクタがJS/HTMLのどこにも（動的生成分も
含めて）現れないか」を機械的に突き合わせる方式で再チェックした。
単純な文字列grepだと`panelBody.classList.add("pcv2-panel-" + panelId)`
のような**動的結合で生成されるクラス名**を誤って「未使用」と判定して
しまうため、既知の`panelId`一覧（control/markers/display/playlist/
text/keyboard/color等）を展開してから照合した。

この方式で新たに見つけて削除したもの：
- `style-pcv2-panels.css`：Exportパネル固有の`.export-range-options`/
  `.export-format-options`/`.export-effect-options`/`.export-radio-row`/
  `.export-checkbox-row`/`.export-marker-select`/`.auto-speed-number`
  （Range/Format/Effect選択UI、QNPITCHには対応するHTML/JSが無い）
- `style-core.css`：`.sidebar-section.text-tab-active`/`.note-textarea`
  （旧QNPLAYERのTextタブ=メモ帳機能用。QNPITCHのRecordingsパネンルは
  `<textarea>`を持たず`#pitchRecListScroll`という別DOMのため無関係）
- `style-theme.css`：`.qn-menu-popup.open-upward`（JS側で付与する処理が
  存在しない未実装の開閉方向分岐）
- `pitch-ui-pc-v2.js`：`switchPanel()`内の
  `panelBody.classList.remove("markers-edit-mode"/"playlist-edit-mode")`
  （対応するCSSを0-0-2で削除済みで、このremove処理自体も対応する
  `add`処理がどこにも無く、常に空振りするだけだった）

**「残すか消すか迷ったら骨組みごと残す」（§0-2）の判断は、
「対応する相方（CSSならJS/HTML側の生成・付与処理、JSならCSS側の
定義）が本当に存在するか」まで確認して初めて安全に下せる。**
コメント内の言及だけ、または削除済みの過去の経緯説明だけを根拠に
「使われているかもしれない」と残すのは、単なる先延ばしであり
今後は避けること。一方、`#pcV2HeaderNav`（コメントアウトで無効化、
再有効化の手順が明記）や認証UIの課金プレースホルダ（未実装だが
実装時の仕様がコメントで明記）のように、**「今は無効化されている
理由」と「将来どう使うか」がコード上に具体的に書かれているもの**は、
引き続き削除せず残す。

---


## 0.【最重要】このプロジェクトの作り方の経緯

### 0-1. 統合の経緯
旧QNTUNER（マイクチューナー＋発信音のTone Generator）と旧QNPITCH
（ピッチロール表示＋録音＋スコア判定）を、1本のアプリ「QNPITCH」に
統合した。ヘッダー右のMODE切替ボタンで「TUNER」「PITCH」を切り替える。

### 0-2.【最重要・開発方針の転換】QNPLAYERを完全コピーしてベースにする
このプロジェクトは開発途中で**根本的な方針転換**を行った経緯があり、
今後このプロジェクトを触るときは必ずこの方針で進めること。

**背景**：当初は「QNPLAYERの構造を見て、型だけを再実装する」という
進め方をしていたが、この方式では余白・フォントサイズ・スクロール
バーの色・アイコンバーのサイズ感といった細部が必ずQNPLAYERとズレる
ことが判明した（ユーザーからの強い指摘：「大枠は完全に同じにして」
「複製を優先し、そこから要素だけ差し替える」）。

**現在の方針**：
1. QNPLAYERのPC v2シェル関連ファイル（`index.html`、
   `CSS/style-core.css`、`CSS/style-layout-pc-v2.css`、
   `CSS/style-pcv2-panels.css`、`CSS/style-auth.css`、
   `CSS/style-theme.css`、`JS/player-ui-pc-v2.js`→
   `pitch-ui-pc-v2.js`、`JS/player-theme.js`→`pitch-theme.js`、
   `JS/player-auth.js`→`pitch-auth.js`）を、**中身を一切書き換えず
   まずファイルごとコピー**してプロジェクトの土台にする。
2. コピーしたファイルの中から、**QNPLAYER固有の機能（プレイリスト・
   マーカー・EQ・Speed/Key・波形描画・Export/Backup/Import等）を
   持つ部分だけを特定し、そこだけをQNPITCH用の中身に置き換える**。
   骨格（DOM構造・CSSクラス名・ID命名パターン・数値・スクロール
   バーの見た目）は一切変更しない。
3. **「明らかに使わない機能は削除してよい」「判断に迷うものは
   骨組みごと残す」**（ユーザーの指示：「削除は簡単でも複製は人間に
   は骨が折れる」）。迷ったら空のグループ・空のボタン領域として
   残し、動くものを見ながら都度ユーザーに判断を仰ぐ。
4. 新規要素（TUNER/PITCH MODE切替ボタン、ヘッダーのマイクON/OFF
   ボタンなど、QNPLAYERに存在しない概念）は、既存のQNPLAYERの型
   （`#qnMenuBtn`の丸ボタン、`.pcv2-icon-item`のピル型ボタン等）に
   デザインを揃えて新規実装する。**この新規CSSを書き忘れると、
   ブラウザ既定のボタンスタイル（灰色の四角、影や角丸なし）が
   そのまま見えてしまう**（実際に発生した不具合、§3参照）。

### 0-3. HTML/CSS/JSは独立した工程では進められない
QNPLAYERの`build()`は「HTMLの既存要素をJSが動的に組み立て直す」
設計のため、HTML→CSS→JSと順番にきれいに進めることはできない。
実際には、HTMLの骨組みを置きながらJSで動作確認し、ズレがあれば
両方を行き来して直す、という進め方になる。

### 0-4. 静的HTML方式（重要な設計転換）
開発の初期段階では、パネルの中身をJS側で`innerHTML`により動的生成
していたが、これもQNPLAYERの`initPanels()`/`markAnchor()`/
`switchPanel()`の型を活かせないため、**QNPLAYERと同じ「静的HTMLを
`index.html`に用意しておき、JSがそれをDOM移動する」方式**に統一した。
- `.player-section`（`#pitchTunerSection`・`#pitchPitchSection`）が
  メインエリア（QNPLAYERの波形エリア相当）
- `.sidebar-section`内の`.mobile-tab-panel`（`data-tab-panel="control"`
  等）が各パネルの中身（Tone Generator・Sensitivity・Filters・
  Recordings）
- `pitch-ui-pc-v2.js`の`initPanels()`が、これらの要素を
  `#pcV2WaveArea`・`#pcV2PanelBody`へ実際にDOM移動する

---

## 1. ファイル構成

```text
QNPITCH/
├── index.html                  # QNPLAYERの静的HTML方式を完全踏襲。
│                                #   .app-container > .player-section×2
│                                #   （tuner/pitch） + .sidebar-section
│                                #   （4つの.mobile-tab-panel）+ 保存/
│                                #   リネーム/クリア確認ダイアログ
│                                #   （export-modal型）。
├── JS/
│   ├── pitch-core.js           # 共通：ピッチ検出（自己相関法）・
│   │                           #   音名変換。旧QNTUNER/旧QNPITCHの
│   │                           #   重複実装を統合。
│   ├── pitch-auth.js           # QNPLAYERのplayer-auth.jsを完全
│   │                           #   コピー。Firebaseプロジェクトは
│   │                           #   QNPLAYERと同一（qnaudio-8b46e）。
│   ├── pitch-ui-pc-v2.js       # 【最重要】QNPLAYERのplayer-ui-
│   │                           #   pc-v2.js(2195行)を完全コピーし、
│   │                           #   PLAYER固有部分を削除・QNPITCH用に
│   │                           #   置換したもの(約1150行)。アイコン
│   │                           #   バー・パネル開閉・MODE切替・
│   │                           #   ヘッダーマイクボタン制御を持つ。
│   ├── pitch-ui-shared.js      # QNPLAYERのplayer-ui-shared.js
│   │                           #   (1072行)から、haptic系・モバイル
│   │                           #   タブ切替・スライダー進捗表示の
│   │                           #   3つだけを抽出した新規ファイル
│   │                           #   （残りは全てPLAYER固有のため）。
│   ├── pitch-theme.js          # QNPLAYERのplayer-theme.jsを完全
│   │                           #   コピーし、ハンバーガーボタン
│   │                           #   （#qnMenuBtn/#qnMenuPopup、PC v2
│   │                           #   では常時非表示のため削除して問題
│   │                           #   ない）の開閉ロジックだけ削除。
│   │                           #   42色テーマ・Glowアニメーションは
│   │                           #   そのまま。
│   ├── pitch-mode-tuner.js     # TUNERMODE：Mic Tuner・Tone
│   │                           #   Generator・Sensitivity。
│   ├── pitch-mode-pitch.js     # PITCHMODE：ピッチロール・録音・
│   │                           #   再生・スコア判定。
│   ├── pitch-filters.js        # フィルタ処理・スコア判定ロジック
│   │                           #   （旧QNPITCH移植）とその設定パネル
│   │                           #   （.control-card型）。
│   └── pitch-recordings.js     # 録音のIndexedDB永続化・保存/
│                                #   リネーム/クリア確認ダイアログ制御
│                                #   （export-modal型、.openクラスで
│                                #   開閉）。
├── CSS/
│   ├── style-core.css          # QNPLAYERから完全コピー＋QNPITCH
│   │                           #   固有要素（ヘッダーMODE切替・
│   │                           #   マイクボタン・スプラッシュ・
│   │                           #   [hidden]優先度修正）を追記。
│   ├── style-layout-pc-v2.css  # QNPLAYERから完全コピー（1文字も
│   │                           #   変更していない）。
│   ├── style-pcv2-panels.css   # QNPLAYERから完全コピー。
│   ├── style-auth.css          # QNPLAYERから完全コピー。
│   ├── style-theme.css         # QNPLAYERから完全コピー。
│   ├── style-mode-tuner.css    # TUNERMODE固有スタイル（Gauge/
│   │                           #   Guitar Meter表示、Tone Generator
│   │                           #   の弦リスト等）。
│   ├── style-mode-pitch.css    # PITCHMODE固有スタイル（ピッチ
│   │                           #   ロール、音量パネル、再生情報行）。
│   ├── style-filters.css       # （現状ほぼ空、.control-card型を
│   │                           #   style-core.cssから流用している
│   │                           #   ため追加スタイルは最小限）
│   └── style-recordings.css    # 録音一覧（.pitch-rec-row）と、
│                                #   保存/リネーム/クリア確認ダイアログ
│                                #   （.export-modal-overlay型、
│                                #   QNPLAYERのstyle-export.cssから
│                                #   該当部分のみ移植）。
├── favicon/                    # プレースホルダ（単色円）。正式ロゴ
│                                #   は未着手。
└── md/
    └── AI_ASSISTANT_PROJECT_CONTEXT.md   # このファイル。
```

---

## 2. 最重要の設計事実

### 2-1.【重大バグ】`.player-section[hidden]`が効かない問題
`.player-section { display: flex; }`（QNPLAYERの元CSS）は、ブラウザ
既定の`[hidden] { display: none; }`より詳細度で勝ってしまうため、
TUNERMODE/PITCHMODEの`hidden`属性だけでは非表示にならず、**両方の
セクションが同時に縦に並んで表示される**不具合が実際に発生した。
QNPLAYERにはモード概念が無いため、この問題は元々存在しなかった。

**対処**：`style-core.css`に`.player-section[hidden] { display:
none; }`を明示的に追加して解決した。**今後、`hidden`属性で表示制御
する新しい要素を追加する場合、対象の要素（またはその祖先）が
`display`をflex/grid/block等で明示指定するクラスを持っていないか
必ず確認すること。**指定がある場合は、同様に`[hidden]`優先ルールを
追加しないと同じ不具合が起きる。

### 2-2.【重大バグ】モード切替時にパネルの中身が更新されない問題
`setMode()`が呼んでいた`closePanelOverlay()`は、QNPLAYERの元設計
では「開いていたパネルを閉じて、内部状態を`mainview`に揃えるだけ」
の処理（PC幅では元々パネルは常時表示されたままなので、これで
見た目上は「アイコンバーの色が変わるだけ」で十分だった）。

QNPITCHではモード切替のたびにパネルの中身自体（Tone Generator→
Filters等）を差し替える必要があるのに、`closePanelOverlay()`だけ
では中身が更新されず、**PITCHMODEに切り替えてもTUNERMODEのパネル
（Tone Generator）が表示されたままになる**不具合が発生した。

**対処**：`setMode()`内で、PC幅時は`switchPanel(mode === "tuner"
? "control" : "playlist")`を明示的に呼んで、新モードの最初の
パネルを開き直すようにした（`pitch-ui-pc-v2.js`の`setMode()`
参照）。**QNPLAYERの関数をそのまま呼ぶだけでは「モード」という
QNPITCH固有の概念に対応できない箇所がある**という教訓。

### 2-3.【重大バグ】新規UI要素のCSS書き忘れ
「QNPLAYERを完全コピーする」方針に転換した際、QNPLAYERに存在しない
QNPITCH固有の新規要素（`#pitchModeToggle`・`.pitch-mode-btn`・
`#pitchHeaderMicBtn`）用のCSSを、**一度もどのファイルにも書いて
いなかった**。この結果、TUNER/PITCH切替ボタンやマイクボタンが
ブラウザ既定のボタンスタイル（灰色の四角）のまま表示される不具合が
発生した。

**教訓**：「完全コピー」方針は既存要素の忠実さを保証するが、
**QNPITCH固有の新規要素は当然コピー元に存在しないため、CSSを
書く責任は変わらず自分にある**。新規のDOM要素をHTMLに追加したら、
その場で対応するCSSも必ず書く（後回しにすると書き忘れやすい）。

### 2-4. 下部バーのボタンラベルはデフォルト非表示（QNPLAYERの仕様）
QNPLAYERの`#pcV2BottomBar .pcv2-ctrl-btn span`は、コメントに
「ボタン内ラベルはモックのctrl-btn同様、デフォルト非表示（Marker系
だけ表示する）」とある通り、**意図的にデフォルト非表示**になって
いる（`+Marker`ボタンと`Loop`ボタンだけ例外的に`display: block`）。

QNPITCHのPLAY/SAVE/CLEARボタンも同様に「重要な操作」に当たるため、
`style-mode-pitch.css`で同じ例外パターンとして`display: block`を
明示指定している。**下部バーに新しいボタンを追加する際は、ラベルを
表示したいなら明示的にこの指定を追加すること**（デフォルトでは
見えない）。

### 2-5. パネル登録・DOM移動の型（QNPLAYERと共通）
- `switchPanel(panelId)`が、`#pcV2PanelBody`の中身を差し替える前に
  `stashPanelContents()`で現在の中身を`#pcV2PanelStash`（非表示の
  退避場所）へ移す。`innerHTML = ""`で直接破棄すると、パネルを
  閉じている間の裏側の更新（マイク解析結果の反映等）が空振りする
  ため、必ずこの退避経路を通す（QNPLAYER側の教訓をそのまま踏襲）。
- Color/Keyboardパネルは`tryClaimQnSections()`/
  `renderQnMenuSectionPanel()`により、`#qnMenuMount`内の
  `.qn-menu-section`をDOM移動して表示する。この仕組み自体は
  QNPLAYERから1文字も変えていない。

---

## 3. 過去のバグ修正履歴（Gotchas）

| 症状 | 原因 | 対処 | 参照 |
|---|---|---|---|
| TUNER/PITCHが縦に並んで両方表示される | `.player-section`の`display:flex`が`[hidden]`より詳細度で勝つ | `.player-section[hidden]{display:none}`を追加 | §2-1 |
| モード切替ボタンを押してもパネルの中身が変わらない | `closePanelOverlay()`は状態を`mainview`にするだけで`switchPanel()`を呼ばない | `setMode()`内で`switchPanel()`を明示的に呼ぶ | §2-2 |
| TUNER/PITCH切替ボタン・マイクボタンにCSSが当たっていない（灰色の四角） | QNPITCH固有の新規要素のCSSを書き忘れていた | `style-core.css`末尾に追記 | §2-3 |
| 下部バーのPLAY/SAVE/CLEARにラベルが出ない | QNPLAYERの`.pcv2-ctrl-btn span`はデフォルト非表示の仕様 | `style-mode-pitch.css`で明示的に`display:block` | §2-4 |
| PITCHモードから戻るとサイドバー下段のColor/Keyboardアイコンが消える | `renderIconBarItems()`の`iconBar.querySelectorAll(".pcv2-icon-item")`が、`#pcV2IconBarBottom`内の同名クラスのボタンまで巻き込んで削除していた | `iconBar.children`のうち直接の子だけを対象にし、`bottomGroup`を避けて`insertBefore`する形に変更 | §2-6 |
| Pitch Rollメイン画面が縦に長すぎてスクロールしないと下部ボタンが見えない | `#pcV2WaveArea`が`overflow-y:auto`のQNPLAYER仕様のまま。中の`.player-section`をflexにしても外側がスクロールする | `#pcV2WaveArea:has(.player-section[data-pitch-mode="pitch"]:not([hidden])) { overflow-y: hidden; }`で1画面固定化。PLAY/SAVE/CLEARを`#pcV2BottomBar`からメイン画面最下段（`#pitchPitchControls`）へ移設 | §2-7 |
| （v1.0.1で修正したはずなのに）PITCHモードから戻るとサイドバー下段のアイコンがまだ下寄せになる | `renderIconBarItems()`が新しいボタンを`bottomGroup`の**直前**に`insertBefore`していたが、正しくは`spacer`（`flex:1`の余白要素）の直前に挿入すべきだった。`bottomGroup`の直前に挿すと「spacer→新ボタン→bottomGroup」の順になり、`flex:1`のspacerが上段ボタンごと押し下げてしまう | `insertBefore`の対象を`bottomGroup`から`spacer`（`#pcV2IconBarSpacer`）に変更 | §2-9 |
| Sensitivity/Filtersパネルの左右余白がゼロ（パネルタイトルと横幅が揃わない） | QNPLAYERの`#pcV2PanelBody.pcv2-panel-playlist, #pcV2PanelBody.pcv2-panel-markers { padding: 8px 0; }`（Markers/Playlistの行側が独自の左右余白を持つ設計のための上書き）が、QNPITCHの`.control-card`型コンテンツにもそのまま適用されていた | 該当ルールをベースの`padding: 16px 20px`に戻す。付随する`::after`のフローティングボタン用140px余白も無効化 | §2-10 |
| Save/Rename/Clearパネルで、OKボタンが横幅いっぱいに広がりCancelボタンが画面外にはみ出す | QNPLAYERの`#pcV2PanelBody .export-run-btn { width: 100%; }`（Exportパネルを常時表示パネルとして使う際の専用調整、IDセレクタ込みで詳細度が高い）が、QNPITCHの一時パネルにもそのまま適用されていた | `#pcV2PanelBody .pitch-temp-panel-footer .export-run-btn`のようにIDセレクタを含む同等以上の詳細度で明示的に上書き | §2-11 |

**このセクションは今後も、修正のたびに追記していくこと。**

### 2-9. アイコンバーの再構築で「どの要素の前に挿入するか」を誤ると、v1.0.1の修正が再発する
v1.0.1で「`renderIconBarItems`が`bottomGroup`内のボタンまで削除してしまう」不具合を直した際、削除対象は正しく限定できたが、**挿入位置**（`insertBefore`の第二引数）を誤って`bottomGroup`の直前にしていた。アイコンバーは実際には
`[mainview] [上段ボタン...] [spacer(flex:1)] [bottomGroup]`
という並びで、`spacer`が余った縦スペースを埋めることで`bottomGroup`を画面最下部に固定している。新しいボタンを`bottomGroup`の直前に挿すと`spacer`の**後ろ**に入ってしまい、`spacer`が上段ボタンごと押し下げる形になる。**アイコンバーに要素を動的挿入する処理を書く／直す際は、必ず`spacer`要素を基準に「その直前」に挿入すること。**

### 2-10. QNPLAYERの`#pcV2PanelBody.pcv2-panel-*`個別上書きは、パネルの中身の設計が違うと事故る
QNPLAYERは「どのパネル種別か」によって`#pcV2PanelBody`のpadding等を細かく出し分けている（Playlist/Markersは行自体が余白を持つので本体の左右paddingを外す、Textはtextareaを目一杯広げる、等）。QNPITCHは`markers`をSensitivity、`playlist`をFiltersという**全く別内容**に転用しているため、この手の「パネル種別ごとの個別最適化」はQNPITCH側の内容に対しては前提が崩れており、**そのまま使うと事故る**。新しいパネル種別をQNPITCHで使う際は、`style-pcv2-panels.css`内に`#pcV2PanelBody.pcv2-panel-<既存のQNPLAYER種別名>`という個別ルールが無いか必ず確認すること。

### 2-11. QNPLAYERの「IDセレクタ込み」の上書きは、クラスだけの新規ルールでは打ち消せない
`style-pcv2-panels.css`には`#pcV2PanelBody .export-run-btn`のような、**IDセレクタを含む**選択的な上書きが複数ある（Exportパネルを常時表示させるための調整）。QNPITCH側で同じクラス（`.export-run-btn`等、QNPLAYERの見た目を流用する目的でそのまま使っているクラス）を別の文脈で使う場合、**クラスセレクタだけの新しいルールを後から書いても、CSS詳細度でIDセレクタ込みのルールに负ける**。打ち消すには`#pcV2PanelBody .（文脈を絞るクラス） .export-run-btn`のように、同じIDセレクタを含めた形で書く必要がある。この手の「見えない詳細度の罠」は今後も起こりうるため、**QNPLAYER由来のクラスをQNPITCH側で別文脈に流用する時は、`style-pcv2-panels.css`内にそのクラスへの`#pcV2PanelBody`絡みの上書きが無いか毎回確認する**のが安全。

### 2-6. アイコンバー再構築時の子要素巻き込み削除に注意
`renderIconBarItems(iconBar)`は`setMode()`のたびに上段アイコン
（Tone Generator/Sensitivity/Filters/Recordings等）を再構築するが、
`iconBar.querySelectorAll(".pcv2-icon-item")`のような**子孫全体を
対象にしたセレクタ**を使うと、`#pcV2IconBarBottom`（Color/Keyboard、
`build()`時に1回だけ作られる）内の同じクラスを持つボタンまで巻き
込んで削除してしまう。**アイコンバーの特定領域だけを再構築する
関数を書く時は、対象を`iconBar.children`のうち条件に合うものだけに
絞り、他の子要素（下段グループ等）には触れないこと。**

### 2-7. `#pcV2WaveArea`のスクロール挙動はモードごとに変える必要がある
QNPLAYERの`#pcV2WaveArea`は`overflow-y: auto`が前提（Markers/
Playlist等、中身が多くなりうるパネルをここに表示することがある
ため）。しかしQNPITCHのPITCHMODEのように「1画面に収めて、下部
コントロールを常に固定表示したい」というケースでは、この
`overflow-y: auto`が邪魔になる。**`:has()`セレクタで
`.player-section[data-pitch-mode="..."]`の状態を見て、モードごとに
`#pcV2WaveArea`自体のoverflow挙動を出し分ける**という手法で対応した
（`style-mode-pitch.css`参照）。今後、TUNERMODE側でも同様に「1画面に
収めたいがQNPLAYER標準のスクロール挙動では収まらない」場面が出たら、
同じ手法を使う。

### 2-8.【v1.0.1】レイアウト変更：QNPLAYER型から意図的に離脱した箇所
ユーザー指示「下部フッターは撤去、PLAYERと変わってもいい。
ヘッダー・サイドバー・パネルは維持」を受けて、以下はQNPLAYERの型を
離れてQNPITCH独自の構成にした。**今後、これらの部分をQNPLAYERの型に
"寄せ直す"必要はない**（意図的な離脱であり、不具合ではない）。

- **`.top-controls`/`.time-controls-row`の枠を撤去**：QNPLAYERの
  `#topControls`（Prev/Play/Next等のトランスポート）に相当する枠を
  `index.html`から削除した。TUNERMODE/PITCHMODEとも、メイン表示
  エリアだけのシンプルな縦積みにした。
- **`#pcV2BottomBar`（QNPLAYERのgroup1+divider+group2の型）から
  PLAY/SAVE/CLEARを撤去**：メイン画面自体の最下段
  （`#pitchPitchControls`、PITCHMODEの`.player-section`の直接の子）
  に固定表示する専用行を新設した。`#pcV2BottomBar`自体の型
  （2グループ+区切り線）はまだ空のまま残してある（§0-2「怪しいのは
  残していい」方針）。
- **TUNERMODEのゲージ（Gauge表示）を大型化**：CSS側の`max-width`を
  280px→480pxへ拡大。目盛り線を-50〜+50セント・10セント刻みの11本
  （0/±20/±40は太い目盛り、0は特に強調）に増やした
  （`pitch-mode-tuner.js`の`buildGaugeTicksSvg()`参照）。

### 2-12.【v1.0.2】UI簡素化・機能分離
- **タイトル文言の削除**：`#pitchTunerTitle`（"Mic Tuner"）、
  `#pitchPitchTitle`（"Pitch Roll"）、Googleログインボタンの
  "Googleでログイン"文字、マイク許可導線の🎙アイコンを削除し、
  見た目を簡素化した。
- **`#pcV2BottomBar`を完全に見えなくした**：`height:0; padding:0;
  overflow:hidden; border-top:none;`で潰している。JS側のDOM生成
  自体はまだ残っている（SP幅レイアウト計算で多数参照されているため、
  完全削除は次回の「掃除」タイミングで改めて相談する約束になっている。
  勝手に削除しないこと）。
- **Save/Rename/Clear確認を中央モーダルからパネル方式に変更**：
  `.export-modal-overlay`（中央寄せオーバーレイ）は`index.html`から
  削除し、`#pcV2PanelBody`に一時的に表示する方式にした
  （`pitch-ui-pc-v2.js`の`openTemporaryPanel`/`closeTemporaryPanel`/
  `renderTemporaryPanel`、`pitch-recordings.js`の`openSaveDialog`等が
  Promiseで結果を待つ設計はそのまま）。開く前に表示していたパネルを
  `panelBeforeTemporary`に記憶し、閉じたら自動でそこへ戻る。
- **Main DisplayをSensitivityパネルから分離**：新しい`display`という
  `ICON_ITEMS`項目・`.mobile-tab-panel[data-tab-panel="display"]`を
  追加した。プルダウンではなく、Gauge/Guitar Meterそれぞれの簡易
  プレビュー（SVG、`pitch-mode-tuner.js`の`initDisplayPanel()`が
  動的生成）付きの選択カードを縦に2段並べる方式にした。

### 2-13.【v1.0.3】#pcV2BottomBarをJS側からも完全削除
v1.0.2では「見た目だけCSSで高さ0にして隠す」対応に留めていたが、
v1.0.3でユーザーの明示的な指示により、`pitch-ui-pc-v2.js`の`build()`
内から**`bottomBar`要素の生成・DOM追加、SP幅アンカータブ
（`anchorTabs`）、`alignPlayAnchorTab`、`syncBottomBarPosition`関数
本体を丸ごと削除**した。もう`#pcV2BottomBar`というDOM要素自体が
生成されない。残っている参照（`updatePcv2BottomBarsHeightVar`内、
`setMode()`内の`renderBottomBar`呼び出し）はすべて
`if (bottomBar) { ... }`のnullガード付きのため、要素が存在しなくても
エラーにならず安全に空振りする。**`renderBottomBar`関数自体（下段
バーの中身を組み立てる関数）はまだ`pitch-ui-pc-v2.js`内に残って
いる**（呼び出し元が無いだけで、コードとしては生きている）。次に
このファイルを大きく触る際、デッドコードとして整理してよい。

### 2-14.【v1.0.4】PITCHMODEに録音（REC）ボタンを追加
それまでPITCHMODEの録音開始/停止は、ヘッダーの共通マイクボタン
（`#pitchHeaderMicBtn`、TUNERMODEのMic起動と兼用）でのみ操作する
設計だったが、ユーザーから「PITCHに録音ボタンが無い」との指摘を受け、
`#pitchPitchControls`（メイン画面最下段、Play/Save/Clearの並び）の
先頭に専用の`#pitchRecBtn`を追加した。クリックで`pitch-mode-pitch.js`
の`beginRecording()`/`endRecording()`を呼ぶ（ヘッダーのマイクボタンと
同じ関数を共有）。録音中は`.is-recording`クラスが付与され赤くなり、
ラベルが「Rec」→「Stop」に切り替わる（`updateHeaderMicBtn()`関数が
ヘッダーボタンとRecボタン両方の見た目を一括更新する設計、関数名は
歴史的経緯でヘッダー由来のままだが両方を面倒見ている点に注意）。

---

## 3-1.【重要】直近セッションの作業方針（次セッションでも継続）
ユーザーから「プレビュー生成・構文チェック・スクリーンショット確認は
リソースの無駄、修正したらすぐZIPで渡せ」という明確な指示があった。
v1.0.3以降は以下の方針で進めている。**次のセッションでも、別途
指示があるまでこの方針を継続すること**：
- 修正は該当ファイルに直接パッチを当てるだけ。
- プレビュー用HTMLの生成（`preview_combined.html`等）はしない。
- ブラウザでの動作確認・Playwrightでのスクリーンショット撮影は
  しない。
- 構文チェックは`node --check`や波括弧カウントのような、コストの
  低いテキストレベルのチェックに留める（必要ならごく短時間で）。
- 修正が終わったら即座に`/mnt/user-data/outputs/QNPITCH<version>.zip`
  としてパッケージし、`present_files`で渡す。長い説明や確認の
  やり取りは挟まない。

---

## 4. 今回のスコープ外（次回以降に実装）

- **KEY&DRONE**（スケールハイライト・基準ピッチ再生） — 旧QNPITCHに
  存在した機能だが未移植
- **内蔵メトロノーム** — ユーザー了承済みで後回し（QNTEMPOのロジック
  移植を想定）
- **ピンチズーム**（ピッチロールの表示密度可変） — 現状は固定表示
  密度（`VISIBLE_ROWS = 22`）
- **ノートラベルのタップ発音**
- **Keyboard Shortcutsの中身** — `window.QN_SHORTCUTS`は
  `index.html`側で未定義のまま。アイコン設置のみ済み
- **課金ロジック本体**（`pitch-shareware.js`相当） — Googleログイン
  基盤のみ実装済み、`window.qnpitchSyncUnlockWithFirestore`は未実装

---

## 5.【将来構想】QNPLAYERとの合体・PLAYER再生中の連携

ユーザーの将来構想：QNPLAYERの再生中にQNPITCHでギターチューニング
をしたり、曲を流しながら自分の声の音程をチェックする（カラオケ
採点的な用途）ができるようにしたい、という要望がある。

`pitch-core.js`の`createAnalysisSession()`は、この将来像を見据えて
`startFromMic()`だけでなく`startFromNode(existingAudioCtx,
existingSourceNode)`という入口も用意してある。将来、PLAYER側の
再生音声ノードをこの関数に渡すだけで「曲の音程」も解析できるように
なる設計。

またQNPLAYERと合体する可能性も見据え、PC v2シェル部分は完全コピー
方式で作っているため、将来的に「QNPITCHのパネル・メインエリアを、
QNPLAYERのiconBarに項目追加する形で統合する」ことも比較的容易な
はず（§0-2の方針が活きる）。

---

## 6. ドキュメント運用ルール

1. 修正依頼を受けたら、着手前に本ドキュメントの該当セクション
   （特に§2「最重要の設計事実」）を必ず確認する。
2. **§0-2の方針（QNPLAYER完全コピー、明らかに不要なものだけ削除、
   判断に迷うものは骨組みごと残す）を、以後の全ての変更で徹底
   すること。** 「型だけ再実装する」方式に戻らない。
3. 新しいUI要素をHTMLに追加したら、その場で対応するCSSも書く
   （§2-3の教訓）。「後で書く」は書き忘れの元。
4. `hidden`属性で表示制御する要素を追加する場合、祖先要素の
   `display`指定と衝突しないか確認する（§2-1の教訓）。
5. 修正やバグ調査を1件終えるたびに、このドキュメントの該当
   セクション（§1構成／§2設計事実／§3バグ履歴／§4スコープ外／
   §6運用ルール自体）に反映が必要かを確認し、該当すれば追記する。
6. 動作確認は可能な限り実際にレンダリングして検証する
   （Playwright等でDOM状態・computed styleを確認するのが確実。
   コードレビューだけでは`display:none`の優先順位のような問題を
   見落とす）。
