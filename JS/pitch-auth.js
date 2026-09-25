// ============================================================
// pitch-auth.js
// Firebase Authentication（Googleログイン）連携。QNPLAYERのplayer-auth.jsが
// 由来（md §0-5参照）。firebaseConfigはQNPLAYERと同一プロジェクト
// （qnaudio-8b46e）を指し、ログイン状態・課金情報は将来全QNアプリで共有される。
// ES modules方式のため、index.html側では
//   <script type="module" src="JS/pitch-auth.js"></script>
// として読み込むこと。
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- firebaseConfig ---
const firebaseConfig = {
  apiKey: "AIzaSyDk7vNEqLxM2DDLacZID8U0ohZfrOnRaWI",
  authDomain: "qnaudio-8b46e.firebaseapp.com",
  projectId: "qnaudio-8b46e",
  storageBucket: "qnaudio-8b46e.appspot.com",
  messagingSenderId: "107377155809",
  appId: "1:107377155809:web:7a0326f08dce73e92d21a0"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();
// ログイン毎に必ずGoogleのアカウント選択画面を出す設定。
// これが無いと、ブラウザが前回ログインしたアカウントを記憶していて、
// 「ログアウト→別アカウントでログイン」をしたい時に、確認なしで
// 同じアカウントに自動で再ログインしてしまい、アカウントを切り替え
// られない（動作検証時、複数アカウントでのテストがしづらいという
// 指摘を受けての対応）。
googleProvider.setCustomParameters({ prompt: "select_account" });
const db = getFirestore(firebaseApp);

// --- Firestore: 購入/解除フラグ(unlockUntil)の読み書き ---
// コレクション: users/{uid}  フィールド: unlockUntil (number), updatedAt (serverTimestamp)
// unlockUntilの意味はplayer-shareware.js側のlocalStorageキーと同じ
// （-1=Premium永久解除、それ以外=epoch msまでの時限解除、0/未設定=無料版）。
// マージ時に「どちらの操作が新しいか」を判定するため、updatedAtも一緒に返す
// （epoch msに変換。ドキュメント未作成、またはサーバー側の反映待ちでnullの場合は0扱い）。
// purchasedAtMsは、Cloud Functions(stripeWebhook)がStripe決済確定時に書き込んだ
// タイムスタンプ。存在する場合、player-shareware.js側でローカルとの新旧比較より
// 優先して採用するために使う（決済結果が古いlocalStorageの値で上書きされる事故防止）。
// planTypeは、Cloud Functionsが決済のPrice IDから判定した契約プランの種類
// （"monthly" / "yearly" / "lifetime"）。広告視聴による時限解除の場合はnull。
// player-shareware.js側で「今契約中のプランと同等・下位のボタンを隠す」
// 階層表示に使う。
// cancelAtPeriodEndは、Stripeのsubscription.cancel_at_period_endをそのまま
// 反映したもの（Cloud Functions側、customer.subscription.updatedイベントで
// 書き込み）。true = 既に解約手続き済みで、期限（unlockUntil）到達後は
// 自動更新されない。フィールド自体が無い場合（バックエンド未対応時点の
// 古いドキュメント等）はfalse扱いにする。
//
// 戻り値は3パターン：
//   null = ドキュメント自体が存在しない（本当の新規ユーザー等）
//   { corrupted: true } = ドキュメントは存在するが、unlockUntilが数値として
//     不正（NaN等）。バックエンド側の書き込みミスの可能性が高い異常系。
//     「存在しない」と区別することで、呼び出し元が誤って無料版へ
//     自動初期化してしまう事故を防ぐ（実際にこれが原因で「解約したら
//     即座にFREEに戻った」という不具合が発生したことがある）。
//   { unlockUntil, ... } = 正常なデータ
async function fetchUnlockUntilFromFirestore(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;

    const data = snap.data();
    // 【重要】typeof NaN === "number" は true になるため、typeofだけの
    // チェックだとNaN値でもここを通過してしまう。Number.isFinite()で
    // 「実際に有限の数値か」まで確認する（-1や0、正の数はtrueになり、
    // NaN・Infinity・非数値はfalseになる）。
    if (!Number.isFinite(data.unlockUntil)) {
      console.error("[QN_AUTH] Firestoreのunlock Untilが不正な値です（NaN等）。値:", data.unlockUntil);
      return { corrupted: true };
    }

    const updatedAtMs = data.updatedAt && typeof data.updatedAt.toMillis === "function" ? data.updatedAt.toMillis() : 0;
    const purchasedAtMs = data.purchasedAt && typeof data.purchasedAt.toMillis === "function" ? data.purchasedAt.toMillis() : 0;
    const planType = typeof data.planType === "string" ? data.planType : null;
    const cancelAtPeriodEnd = data.cancelAtPeriodEnd === true;
    return { unlockUntil: data.unlockUntil, updatedAtMs, purchasedAtMs, planType, cancelAtPeriodEnd };
  } catch (err) {
    console.error("[QN_AUTH] Firestore read failed:", err);
    return null;
  }
}

// planTypeを省略した場合はフィールドを変更しない（mergeなので既存値を維持）。
// 明示的にnullを渡した場合は「購入によるプランではなくなった」として
// フィールド自体を削除する（広告視聴による解除・無料版への切り戻し時に使う）。
async function saveUnlockUntilToFirestore(uid, unlockUntil, planType) {
  try {
    const payload = {
      unlockUntil,
      updatedAt: serverTimestamp()
    };
    if (planType === null) {
      payload.planType = deleteField();
    } else if (typeof planType === "string") {
      payload.planType = planType;
    }
    await setDoc(doc(db, "users", uid), payload, { merge: true });
  } catch (err) {
    console.error("[QN_AUTH] Firestore write failed:", err);
  }
}

// 他のJSファイルから現在のユーザー情報を参照できるよう、
// window.QN_AUTHとして公開しておく（QNシリーズ共通の命名パターン）。
// currentUserはonAuthStateChangedが発火するまではnullのまま。
window.QN_AUTH = {
  auth,
  currentUser: null,
  fetchUnlockUntilFromFirestore,
  saveUnlockUntilToFirestore
};// --- DOM要素 ---
const btnLoginGoogle = document.getElementById("btnLoginGoogle");
const btnLogout = document.getElementById("btnLogout");
const userInfoEl = document.getElementById("userInfo");
const userPhotoEl = document.getElementById("userPhoto");
const userNameEl = document.getElementById("userName");

// --- ログイン処理 ---
async function handleLogin() {
  try {
    await signInWithPopup(auth, googleProvider);
    // 成功時のUI更新はonAuthStateChangedに任せる
  } catch (err) {
    // ポップアップを閉じただけ等のキャンセル系エラーはコンソールに出すだけに留める
    console.error("[QN_AUTH] Sign-in failed:", err);
  }
}

// --- ログアウト処理 ---
async function handleLogout() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("[QN_AUTH] Sign-out failed:", err);
  }
}

if (btnLoginGoogle) btnLoginGoogle.addEventListener("click", handleLogin);
if (btnLogout) btnLogout.addEventListener("click", handleLogout);

// 決済ボタン等、他のJSファイルから「ログインを促してから進める」フローで
// 使うため、handleLoginをwindow.QN_AUTH経由でも呼べるようにする。
window.QN_AUTH.login = handleLogin;

// --- ログイン状態監視・UI自動切り替え ---
onAuthStateChanged(auth, async (user) => {
  window.QN_AUTH.currentUser = user;

  if (user) {
    // ログイン時：ユーザー情報を表示
    if (userPhotoEl) userPhotoEl.src = user.photoURL || "";
    if (userNameEl) userNameEl.textContent = user.displayName || user.email || "";
    if (btnLoginGoogle) btnLoginGoogle.style.display = "none";
    if (userInfoEl) userInfoEl.style.display = "flex";

    // Firestoreに保存されている解除状態と、このブラウザのlocalStorageの
    // 解除状態をマージする。§0-4の通り課金ロジック自体（pitch-shareware.js
    // 相当）は現段階で未実装のため、この関数はまだ存在しない前提で
    // 呼び出す（存在チェック付き。実装後、window.qnpitchSyncUnlockWith
    // Firestoreという名前で用意する）。
    if (typeof window.qnpitchSyncUnlockWithFirestore === "function") {
      await window.qnpitchSyncUnlockWithFirestore(user.uid);
    }

    // 他モジュール（購入フラグ判定等）へ通知したい場合はここでカスタムイベントを発火できる。
    // 例: window.dispatchEvent(new CustomEvent("qn-auth-changed", { detail: { user } }));
    window.dispatchEvent(new CustomEvent("qn-auth-changed", {
      detail: { user: { uid: user.uid, email: user.email, displayName: user.displayName } }
    }));
  } else {
    // 未ログイン時
    if (btnLoginGoogle) btnLoginGoogle.style.display = "flex";
    if (userInfoEl) userInfoEl.style.display = "none";

    window.dispatchEvent(new CustomEvent("qn-auth-changed", { detail: { user: null } }));
  }
});


document.addEventListener("DOMContentLoaded", () => {
  const avatarBtn = document.getElementById("userAvatarBtn");
  const dropdown = document.getElementById("userDropdown");

  if (avatarBtn && dropdown) {
    // アイコンクリックで開閉切り替え
    avatarBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("active");
    });

    // ポップアップ内のクリックイベントが外側に伝播しないように制限
    dropdown.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // 画面の他の場所をクリックしたら閉じる
    document.addEventListener("click", () => {
      dropdown.classList.remove("active");
    });
  }
});