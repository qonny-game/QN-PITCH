# QNPITCH プロジェクトコンテキスト & AI協業ガイド（骨組み版）

QNPITCH（QNシリーズの「チューナー＋ピッチ検出」統合ブラウザアプリ。
旧QNTUNER + 旧QNPITCHを1本に統合し、QNPLAYERと同じ設計思想で作り直す
新規プロジェクト）の開発を効率よく進めるための、プロジェクト固有の
知識をまとめたドキュメント。修正依頼の前に該当セクションを確認する
ことで、同じ調査・同じ失敗を繰り返さないようにする。

**現在のステータス：PC v2シェル骨格＋認証基盤の実装が完了。
TUNERMODE/PITCHMODEの中身（メインウインドウ・各パネル・フィルタ・
録音一覧）は未実装。**
このドキュメントは「どのチャットから始めても制作クオリティ・設計方針を
維持する」ために作成。実装が進むごとに、QNPLAYERの
`AI_ASSISTANT_PROJECT_CONTEXT.md`と同じ運用ルール（§5参照）に
従って育てていく。

**実装済みファイル（このセッションで作成）：**
- `index.html` — ヘッダー（ロゴ・MODE切替ボタン・Googleログイン）と
  PC v2シェルのマウント先。TUNERMODE/PITCHMODEの中身のマークアップは
  まだ無い（pitch-ui-pc-v2.js側がJSで動的に構築する設計のため、
  静的HTMLとしては元々書かない）。
- `CSS/style-core.css` — デザイントークン（QNPLAYERと同一）＋
  ヘッダー共通部品＋MODE切替ボタンのスタイル。
- `CSS/style-layout-pc-v2.css` — PC v2シェル骨格のCSS（§0-2の
  「型だけ踏襲」方針で、QNPLAYERからPLAYER固有部分を除いて再構成）。
- `CSS/style-auth.css` — ログインボタン・ユーザードロップダウン
  （QNPLAYERと完全共通、そのまま移植）。
- `JS/pitch-ui-pc-v2.js` — PC v2シェルのJS本体。QNPLAYERの
  player-ui-pc-v2.js（2194行）は丸ごとコピーせず、「ICON_ITEMS的な
  パネル登録の仕組み・パネル開閉・SP/PC自動レイアウト」の型だけを
  再実装。QNPLAYERと異なり、パネル登録は
  `window.QNPitch.panels.register(id, def)` / `window.QNPitch.mainView.
  register(mode, def)` / `window.QNPitch.bottomBar.register(mode, def)`
  という、機能ファイル側から動的に登録する設計にした（QNPITCHには
  QNPLAYERのような「移植元の旧SP版マークアップ」が存在しないための
  簡素化。詳細はファイル冒頭コメント参照）。
- `JS/pitch-core.js` — ピッチ検出コア（§0-3の共通化方針の実体）。
  旧QNTUNER/旧QNPITCHの`autoCorrelate`・音名変換関数を統合。
  `createAnalysisSession()`で入力ソース（マイク／既存AudioNode）を
  差し替え可能にしてあり、§0-2の「将来のPLAYER再生音解析」を見据えた
  設計になっている。
- `JS/pitch-auth.js` — Googleログイン（QNPLAYERのplayer-auth.jsを
  移植。Firebaseプロジェクトはqnaudio-8b46eでQNPLAYERと同一）。

**未着手（次にやること）：**
1. `CSS/style-mode-tuner.css` / `JS/pitch-mode-tuner.js` —
   TUNERMODEのメインウインドウ（ゲージ／弦リスト）・下部バー
   （Start Mic/Stop等）・パネル（Sensitivity、Tone Generator切替等）
2. `CSS/style-mode-pitch.css` / `JS/pitch-mode-pitch.js` —
   PITCHMODEのメインウインドウ（ピッチロール）・下部バー
   （REC/PLAY/LIST等）
3. `CSS/style-filters.css` / `JS/pitch-filters.js` — ノイズ除去・
   スパイク除去・音量ゲート・ビブラート検出等の設定パネル
   （旧QNPITCHの`applyFilters()`一式を移植）
4. `CSS/style-recordings.css` / `JS/pitch-recordings.js` — 録音の
   保存・一覧・リネーム（IndexedDB、`qnpitch_recordings_db`）
5. `JS/pitch-theme.js` — カラーテーマ・ハンバーガーメニュー
   （QNPLAYERのplayer-theme.jsを踏襲）
6. `md/DOM_ID_REFERENCE.md` / `md/CHANGELOG.md` の作成（主要DOM ID・
   バージョニングが固まった段階で着手）
7. favicon一式（QNPLAYERのような実ファイルはまだ用意されていない。
   `index.html`は`favicon/`フォルダを参照する前提で書いてある）。
   **v1.0.0パッケージング時に、単色の円のプレースホルダ画像を仮生成
   済み**（`favicon.ico`・`favicon-16x16.png`等）。正式なロゴが
   決まり次第、差し替えること。
8. `JS/pitch-theme.js` / `CSS/style-theme.css`
   （カラーテーマ切替・ショートカット一覧のハンバーガーメニュー）
   — **v1.0.0パッケージング時点では雛形のみ**（中身は空、
   `#qnMenuMount`のレイアウトが崩れない程度の最小実装）。本実装は
   QNPLAYERのplayer-theme.js/style-theme.cssを参照して次回行う。

**参照元（このドキュメントの設計思想の元ネタ）：**
- QNPLAYER（`QNP2_16_10`）の `md/AI_ASSISTANT_PROJECT_CONTEXT.md` —
  PC v2シェルの設計・運用ルール・ドキュメント更新ルールの参照元。
  **QNPITCHのPC v2シェル部分は、このドキュメントに書かれた設計事実を
  そのまま踏襲する。矛盾が出たらQNPLAYER側のドキュメントを正とする。**
- 旧QNTUNER（`index.html`/`player.js`/`style.css`）— Mic Tuner・
  Tone Generatorのロジック移植元。
- 旧QNPITCH（`index.html`/`app.js`/`style.css`）— ピッチロール表示・
  ノイズ除去フィルタ・ビブラート検出・録音/一覧・スコア判定・
  KEY&DRONEのロジック移植元。

---

## 0. プロジェクトの成り立ちと最重要方針

### 0-1. 統合の経緯
- 旧QNTUNER（マイクチューナー＋発信音/音叉のTone Generator）と、
  旧QNPITCH（ピッチロール表示＋録音＋スコア判定の音痴度チェック）は
  別々のアプリだったが、機能的に重なる部分（マイク入力・ピッチ検出）が
  多いため、1本のアプリ「QNPITCH」に統合する。
- 統合後の呼称は**QNPITCH**（旧QNPITCHの名前を新アプリ全体の名前として
  引き継ぐ）。ヘッダー右のMODE切替ボタンで「TUNERMODE」「PITCHMODE」を
  切り替える構成。

### 0-2.【最重要】QNPLAYERとの将来合体を見据えた設計原則
**いずれQNPLAYERと合体し、「多機能PLAYER」になる可能性がある。**
そのため、実装の最初の段階から以下を徹底し、合体時に不具合が出ない
構造にする。**この節の方針に例外は作らない。**

1. **PC v2シェル（ヘッダー・iconBar・レイアウト骨格）はQNPLAYERと
   同じ設計思想・同じ挙動で実装する。** QNPITCH独自のシェル
   カスタマイズ（見た目・挙動が異なるiconBarやパネル切替の仕組み）は
   一切加えない。
   - **【重要・実装方法の確定事項】`player-ui-pc-v2.js`（2194行）は
     実際に読んだ結果、中身の大半が「プレイリスト・マーカー・
     Speed/Key/EQ等、QNPLAYER固有のトランスポート要素をPC v2
     レイアウトへどう配置するか」というPLAYER専用ロジックだった。
     丸ごとコピーすると無関係なコードだらけになるため、**ファイルを
     丸ごとコピーはしない**。代わりに、以下の「型」だけを踏襲し、
     中身はQNPITCH用にゼロから実装する：
     - `ICON_ITEMS`配列でアイコンバーの項目を定義し、クリックで
       対応パネルを開閉する仕組み（`panelType: "tab"`で既存の
       `.mobile-tab-panel`をそのまま表示する方式）
     - `#pcV2Layout` > `#pcV2IconBar` + `#pcV2Panel`
       (`#pcV2PanelHeader`+`#pcV2PanelBody`) + `#pcV2WaveArea`という
       DOM骨格そのものと、そのCSS側の`@media(max-width:900px)`に
       よるSP/PC自動レイアウト切り替えの仕組み
     - `built`フラグによる一度きりのbuild()実行、`el()`ヘルパー等の
       小さい共通パターン
   - QNPITCH側が実装するのは、その「メインウインドウ（`#pcV2WaveArea`
     相当の位置）」と「iconBarから開くパネルの中身」。
   - メインウインドウ（常時表示）＝ TUNERMODE：ゲージ/弦リスト、
     PITCHMODE：ピッチロール。
   - iconBar→パネル（開閉式の設定・サブ機能）＝ フィルタ設定・
     KEY&DRONE・メトロノーム設定・録音一覧・Tone Generator切替等。
   - 下部バー（Bottom Bar）＝ TUNERMODE：Start Mic/Stop等、
     PITCHMODE：REC/PLAY/LIST等の常用トランスポート。
   - **CSS（`style-layout-pc-v2.css`相当）は、PLAYER固有セレクタ
     （`.player-section`、`#topControls`のボタン群等）を除いた
     骨格部分（`#pcV2Layout`・`#pcV2IconBar`・`#pcV2Panel`・
     `#pcV2WaveArea`のレイアウト・`@media`によるSP切り替え）は
     踏襲してよい（CSSはロジックの密結合が少なく、骨格の再現度を
     優先する）。**
   - デザイントークン（`style-core.css`の`:root`）は完全共通のため
     コピーしてよい（§8参照）。
2. **グローバル名前空間は`window.QNPitch`に一元化する。** 裸の
   グローバル変数・関数（QNPLAYERでいう`playlist`・`pins`・
   `beginSeek()`のようなトップレベル定義）は作らない。すべて
   `window.QNPitch.xxx`の形にぶら下げる。
3. **DOM IDは全て`pitch`接頭辞を付ける。**（例：`pitchRollCanvas`、
   `pitchFilterPopup`、`pitchModeToggleBtn`）ただし、PC v2シェル本体が
   持つID（`#pcV2Root`・`#pcV2IconBar`・`#appHeader`等、QNPLAYERと
   共通のもの）はQNPLAYERの命名をそのまま使う。
4. **IndexedDB/localStorageのキーは全て`qnpitch_`接頭辞を付ける。**
   （例：`qnpitch_recordings_db`、`qnpitch_filters_v1`）
5. **ヘッダー右にTUNER/PITCHのMODE切り替えボタンを追加する。**
   これはQNPLAYERには存在しない、QNPITCH固有のヘッダー要素。
   将来合体する際は、この切替ボタンが「PLAYER/TUNER/PITCH」の
   3モード切替に拡張される可能性がある前提で、拡張しやすい実装
   にしておく。
6. **将来のユースケース：「PLAYER再生中にチューニング」「曲を流し
   ながらの音程チェック（カラオケ採点的な使い方）」を見据える。**
   QNPITCH単体の実装では**マイク入力のみ**を解析対象とし、PLAYERの
   `<audio>`要素との同時稼働自体は扱わない（それは合体後の話）。
   ただし`pitch-core.js`のピッチ検出関数は、**入力ソースを
   `getUserMedia`のマイクストリームに決め打ちせず、AudioNode/
   MediaStreamを引数として受け取れる形**にしておく。こうしておけば、
   将来PLAYER側の再生音声ノードを同じ検出関数に渡すだけで「曲の
   音程」も解析できるようになり、大改造なしで拡張できる。

### 0-3. TUNERMODEとPITCHMODEの関係
- 大分類はTUNERMODE / PITCHMODEの2つのみ（旧QNTUNERの「Tone
  Generator」はTUNERMODE内のサブ切替えとして内包し、独立した大分類
  タブにはしない）。
- マイク入力・ピッチ検出処理は、TUNERMODE・PITCHMODEの両方で
  必要になる共通ロジックなので、**ピッチ検出コアを`pitch-core.js`に
  1本化**し、TUNER/PITCHはその結果を使った**表示だけ**を分岐させる。

### 0-4. 機能移植の方針
- 旧QNPITCHが持つ豊富な機能（ノイズ除去フィルタ設定・急変スキップ・
  スパイク除去・音量ゲート・音程ズレハイライト・ビブラート検出・
  KEY&DRONE・録音/一覧・リネーム・スコア判定・簡易メトロノーム）は
  **全てPITCHMODEにそのまま引き継ぐ**（機能の削減はしない）。
- ただし**内蔵メトロノーム機能の実装は後回し**（`pitch-metronome.js`は
  ファイルの雛形だけ用意し、中身の実装は別途着手する）。

### 0-5. Googleログイン・課金基盤
- 「いずれ課金要素を含める」ため、Googleログイン・FREE/PREMIUM判定の
  基盤はQNPLAYERと**共通化する**。
- QNPLAYERとQNPITCHは**サブドメインが異なる**想定（例：player.○○ /
  pitch.○○）。ブラウザストレージはサブドメイン間で自動共有されない
  ため、`player-auth.js`は**丸ごとコピーしてQNPITCH側にも独立配置**
  する（`pitch-auth.js`）。コードは二重管理になるが、**Firebase
  プロジェクト自体は同一のものを使う**（ログイン状態・課金情報を
  将来的に全QNアプリで共有する前提）。

---

## 1. プロジェクト構成（ファイルマップ・確定版）

```text
QNPITCH/
├── index.html                  # PC v2シェル外枠はQNPLAYERからコピーベース。
│                                #   ヘッダー右にTUNER/PITCH MODE切替ボタンを追加。
├── JS/
│   ├── pitch-core.js           # 共通：マイク入力・ピッチ検出アルゴリズム。
│   │                           #   DOM操作なし。TUNERMODE/PITCHMODE両方から参照。
│   ├── pitch-auth.js           # player-auth.js移植。Googleログイン・
│   │                           #   FREE/PREMIUM判定。Firebaseプロジェクトは
│   │                           #   QNPLAYERと同一のものを使用。
│   ├── pitch-ui-pc-v2.js       # 【PC v2シェル】QNPLAYERのplayer-ui-pc-v2.jsを
│   │                           #   コピーしてベースに、QNPITCH用のメイン
│   │                           #   ウインドウ・パネル差し替え部分を実装。
│   ├── pitch-ui-shared.js      # PC/SP共通のUI操作。
│   ├── pitch-mode-tuner.js     # TUNERMODE：Mic Tuner・Tone Generatorのロジック
│   │                           #   （旧QNTUNERのplayer.jsから移植）。
│   ├── pitch-mode-pitch.js     # PITCHMODE：ピッチロール描画・スコア判定
│   │                           #   （旧QNPITCHのapp.jsから移植）。
│   ├── pitch-filters.js        # ノイズ除去・急変スキップ・スパイク除去・
│   │                           #   音量ゲート・音程ズレハイライト・
│   │                           #   ビブラート検出の設定（旧QNPITCH移植）。
│   ├── pitch-metronome.js      # 【未実装・後回し】内蔵メトロノーム。
│   │                           #   雛形のみ用意。
│   ├── pitch-recordings.js     # 録音の保存・一覧・リネーム（IndexedDB、
│   │                           #   qnpitch_recordings_db）。
│   └── pitch-theme.js          # カラーテーマ・ショートカット一覧
│                                #   （QNPLAYERのplayer-theme.js踏襲）。
├── CSS/
│   ├── style-core.css          # デザイントークン。QNPLAYERのstyle-core.css
│   │                           #   をコピーしてベースにする（:root トークンは
│   │                           #   完全共通、§8参照）。
│   ├── style-layout-pc-v2.css  # 【PC v2シェル】QNPLAYERのものをコピーして
│   │                           #   ベースに、必要最小限の差分のみ追加。
│   ├── style-mode-tuner.css
│   ├── style-mode-pitch.css
│   ├── style-filters.css
│   ├── style-metronome.css     # 【未実装・後回し】
│   ├── style-recordings.css
│   ├── style-auth.css          # QNPLAYERのstyle-auth.cssを踏襲。
│   └── style-theme.css
├── favicon/
└── md/
    ├── AI_ASSISTANT_PROJECT_CONTEXT.md   # このファイル。
    ├── CHANGELOG.md                      # 【未作成】実装開始時に作成。
    ├── DOM_ID_REFERENCE.md               # 【未作成】主要DOM ID確定時に作成。
    └── UI_TERMINOLOGY.md                 # 【未作成】ユーザーとの用語齟齬が
                                           #   出た時点で都度追記。
```

**読み込み順は未確定（実装着手時に決定し、ここに追記する）。**
QNPLAYERの読み込み順（`jszip.min.js → lame_min.js → player-shareware.js
→ player-core.js → player-ui-shared.js → ... → player-ui-pc-v2.js →
player-theme.js → player-auth.js(module)`）を参考に、
`pitch-core.js`が呼ぶ側より前に定義されるよう配置する。

---

## 2. 最重要の設計事実

### 2-1. パネル・メインウインドウ・下部バーの登録は window.load を待つ
`pitch-ui-pc-v2.js`のPC v2シェルは`window.QNPitch.panels.register()`
/ `window.QNPitch.mainView.register()` / `window.QNPitch.bottomBar.
register()`という、機能ファイル（`pitch-mode-tuner.js`等）側からの
動的登録に依存している。シェルの`build()`（実際にDOM上へ描画する
処理）は、登録が全て完了してから実行しないとアイコンバー等が空の
まま構築されてしまう。

`document.readyState`は`<body>`末尾のscriptが動き出す時点で既に
`interactive`（`DOMContentLoaded`前）になっていることがあるため、
`build()`の実行タイミングは`DOMContentLoaded`ではなく`window.load`
（全リソース読み込み完了）を待つようにしてある。新しい機能ファイルを
追加する際は、必ずトップレベルのコードで同期的に`register()`を
呼ぶこと（`DOMContentLoaded`や`setTimeout`等で遅延させると、build()
のタイミングによっては登録が間に合わない可能性がある）。

---

## 3. 過去のバグ修正履歴（Gotchas）

実装ゼロのため空。バグ修正が発生し次第、QNPLAYERと同じ
「現象→原因→解決→教訓」形式で追記する。症状→項目の早見表も
同様に育てていく。

---

## 4. データフロー（実装開始後に追記）

`window.QNPitch`配下の状態変数、IndexedDB（`qnpitch_recordings_db`
等）・localStorageのキー一覧を、実装確定次第ここに整理する。

---

## 5. ドキュメント運用ルール

QNPLAYERの`AI_ASSISTANT_PROJECT_CONTEXT.md` §5と同一のルールを踏襲する：

1. 修正依頼を受けたら、着手前に本ドキュメントの該当セクションを
   必ず確認する。
2. 「見た目」と「永続化」を分けて確認する（`window.QNPitch`内の
   メモリ状態／IndexedDB／localStorageのどれを更新すべきか明確にする）。
3. 録音データ等、量が多くなりうるものを扱う処理では、実体
   （音声Blob等）を含めて全件書き直していないかを毎回自問する
   （QNPLAYER §3-5の教訓を踏襲）。
4. PC v2シェル部分（§0-2）の前提を壊さない。QNPITCH固有のカスタマイズ
   をシェル本体に加えたくなったら、まずQNPLAYER側のドキュメントと
   矛盾しないか確認する。
5. バージョン番号の更新・ZIP化・CHANGELOG追記を行う（実装開始後、
   バージョニング規則をここに確定させる）。
6. **このドキュメント自体を毎回更新する。** 修正やバグ調査を1件
   終えるたびに、QNPLAYER §5と同じ観点（§1構成／§2設計事実／
   §3バグ履歴／§4データフロー／§5運用ルール自体／§6検証コマンド）
   で反映が必要かを確認し、該当すれば追記する。
   - 実装が具体的に進み始めたら、§1の「読み込み順」「未作成ファイル」
     の記述を確定版に更新する。
   - §0-2の設計原則（PC v2シェル同一仕様・名前空間・ID接頭辞・
     ストレージキー接頭辞）に反する実装が発生しそうになったら、
     実装前にこのドキュメントを見直して原則を再確認する。

---

## 6. 毎回の検証コマンド（実装開始後に整備）

QNPLAYER §6と同様の構成（JS構文チェック・HTML構文チェック・CSS波括弧
対応チェック・ID重複チェック・`getElementById`とHTML側`id`定義の
突き合わせ）を、QNPITCH用のファイル名に置き換えて実装開始時に整備する。
加えて、**§0-2の設計原則が守られているかの機械チェック**（IDが
`pitch`接頭辞を持っているか、グローバル変数が`window.QNPitch`配下に
収まっているか等）もこの段階で検討する。

---

## 7. 重さ・端末特有の落とし穴チェックリスト（実装開始後に整備）

QNPLAYER §7を参照しつつ、マイク入力・リアルタイム描画
（ピッチロール、ゲージ）特有の注意点（`requestAnimationFrame`の
間引き、`AudioContext`の生成タイミング等）を実装しながら追記する。

---

## 8. UIデザインの統一ルール

**QNPLAYERの`style-core.css`の`:root`トークンをそのまま使う。**
角丸・文字サイズ・ボタン寸法・イージング・二次ボタン寸法等、
QNPITCH独自のデザイントークンは作らない（§0-2の「PC v2シェル完全
同一仕様」の方針と一貫させるため）。

| 用途 | トークン | 値 |
|---|---|---|
| 文字入りボタン・チップ・トグル・ステッパー・バッジ・セグメント | `--radius-pill` | 999px |
| アイコンだけのボタン | `--radius-round` | 50% |
| 入力欄・テキストエリア・ドロップゾーン | `--radius-field` | 10px |
| ポップアップ・ドロップダウン・カード | `--radius-popup` | 14px |
| モーダル | `--radius-modal` | 20px |
| パネル見出し | `--fs-title` | 20px |
| セクション見出し | `--fs-heading` | 15px |
| リストの主テキスト・入力欄・行ラベル | `--fs-body` | 14px |
| 補足・説明 | `--fs-small` | 12px |
| 極小表示 | `--fs-micro` | 11px |
| 二次ボタン | `--fs-btn` / `--btn-h` / `--btn-pad-x` | 12px / 30px / 14px |
| 主ボタン | `--fs-btn-primary` | 14px |

（詳細はQNPLAYERの`style-core.css`および`AI_ASSISTANT_PROJECT_CONTEXT.md`
§8を参照。リストの行・パネル内の区切りは角丸の枠を使わず線で区切る、
テーマ色の塗り分けルール等も同様に踏襲する。）

---

## 9. 用語対応表（暫定）

| ユーザーの言葉 | 意味・対応するもの |
|---|---|
| TUNERMODE | ヘッダー右のMODE切替で選ぶ、チューナー機能側の画面全体 |
| PITCHMODE | ヘッダー右のMODE切替で選ぶ、ピッチ検出・ロール表示側の画面全体 |
| メインウインドウ | PC v2シェルの波形エリア相当の位置。常時表示される中心コンテンツ
  （TUNERMODEではゲージ/弦リスト、PITCHMODEではピッチロール） |
| iconBar / パネル | QNPLAYERと同じ、左右に出すアイコン列と、そこから開く設定パネル |
| 大手術 | （QNPLAYER/QN-PLAYER PC v2側の用語。QNPITCH独自の大規模
  リファクタリングが発生した場合はここに追記） |

詳細な行き違いが発生した場合は、QNPLAYER方式に倣い、その場で
この表に追記する。
