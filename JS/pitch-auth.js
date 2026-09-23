// ============================================================
// pitch-auth.js
// Firebase Authentication（Googleログイン）連携。
//
// 【移植元】QNPLAYERのJS/player-auth.jsを移植。
// md/AI_ASSISTANT_PROJECT_CONTEXT.md §0-2・§0-5の通り、QNPLAYERと
// QNPITCHはサブドメインが異なる想定（例：player.○○ / pitch.○○）の
// ため、このファイルはQNPLAYER側とコード上は独立（コピー）だが、
// firebaseConfigは同一のFirebaseプロジェクト（qnaudio-8b46e）を指す。
// ログイン状態・課金情報（Firestore側）はプロジェクトが同一のため、
// 将来的に全QNアプリで共有される。
//
// ES modules方式のため、index.html側では
//   <script type="module" src="JS/pitch-auth.js"></script>
// として読み込むこと（通常の<script>ではimportが使えないため）。
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

// --- firebaseConfig（QNPLAYERと同一プロジェクト） ---
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
googleProvider.setCustomParameters({ prompt: "select_account" });
const db = getFirestore(firebaseApp);

// --- Firestore: 購入/解除フラグ(unlockUntil)の読み書き ---
// コレクション: users/{uid}  フィールド: unlockUntil (number), updatedAt (serverTimestamp)
// QNPLAYERと同一のFirestoreプロジェクト・同一スキーマを使うため、
// フィールド設計・優先ルールもQNPLAYER側のドキュメントに準拠する。
async function fetchUnlockUntilFromFirestore(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;

    const data = snap.data();
    if (!Number.isFinite(data.unlockUntil)) {
      console.error("[QNPITCH_AUTH] Firestoreのunlock Untilが不正な値です（NaN等）。値:", data.unlockUntil);
      return { corrupted: true };
    }

    const updatedAtMs = data.updatedAt && typeof data.updatedAt.toMillis === "function" ? data.updatedAt.toMillis() : 0;
    const purchasedAtMs = data.purchasedAt && typeof data.purchasedAt.toMillis === "function" ? data.purchasedAt.toMillis() : 0;
    const planType = typeof data.planType === "string" ? data.planType : null;
    const cancelAtPeriodEnd = data.cancelAtPeriodEnd === true;
    return { unlockUntil: data.unlockUntil, updatedAtMs, purchasedAtMs, planType, cancelAtPeriodEnd };
  } catch (err) {
    console.error("[QNPITCH_AUTH] Firestore read failed:", err);
    return null;
  }
}

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
    console.error("[QNPITCH_AUTH] Firestore write failed:", err);
  }
}

// 他のJSファイルから現在のユーザー情報を参照できるよう、
// window.QNPitch.auth として公開する（§0-2の名前空間規則）。
window.QNPitch = window.QNPitch || {};
window.QNPitch.auth = {
  auth,
  currentUser: null,
  fetchUnlockUntilFromFirestore,
  saveUnlockUntilToFirestore
};

// --- DOM要素 ---
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
    console.error("[QNPITCH_AUTH] Sign-in failed:", err);
  }
}

// --- ログアウト処理 ---
async function handleLogout() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("[QNPITCH_AUTH] Sign-out failed:", err);
  }
}

if (btnLoginGoogle) btnLoginGoogle.addEventListener("click", handleLogin);
if (btnLogout) btnLogout.addEventListener("click", handleLogout);

window.QNPitch.auth.login = handleLogin;

// --- ログイン状態監視・UI自動切り替え ---
onAuthStateChanged(auth, async (user) => {
  window.QNPitch.auth.currentUser = user;

  if (user) {
    if (userPhotoEl) userPhotoEl.src = user.photoURL || "";
    if (userNameEl) userNameEl.textContent = user.displayName || user.email || "";
    if (btnLoginGoogle) btnLoginGoogle.style.display = "none";
    if (userInfoEl) userInfoEl.style.display = "flex";

    // FREE/PREMIUM判定のFirestoreマージ処理は、pitch-shareware.js
    // （課金ロジック本体、§0-4の通り現段階では未実装）が用意され
    // 次第、ここから window.qnpitchSyncUnlockWithFirestore(user.uid)
    // のような形で呼び出す。QNPLAYERのswSyncUnlockWithFirestoreに
    // 相当する処理。
    if (typeof window.qnpitchSyncUnlockWithFirestore === "function") {
      await window.qnpitchSyncUnlockWithFirestore(user.uid);
    }

    window.dispatchEvent(new CustomEvent("qnpitch-auth-changed", {
      detail: { user: { uid: user.uid, email: user.email, displayName: user.displayName } }
    }));
  } else {
    if (btnLoginGoogle) btnLoginGoogle.style.display = "flex";
    if (userInfoEl) userInfoEl.style.display = "none";

    window.dispatchEvent(new CustomEvent("qnpitch-auth-changed", { detail: { user: null } }));
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const avatarBtn = document.getElementById("userAvatarBtn");
  const dropdown = document.getElementById("userDropdown");

  if (avatarBtn && dropdown) {
    avatarBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("active");
    });

    dropdown.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    document.addEventListener("click", () => {
      dropdown.classList.remove("active");
    });
  }
});
