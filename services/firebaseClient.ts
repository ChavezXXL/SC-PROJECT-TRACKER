import { getFirestore, Firestore, collection, getDocs, query, limit } from "firebase/firestore";
import * as firebaseApp from "firebase/app";

const STORAGE_KEY_FB = 'nexus_firebase_config';

// Read from environment variables (set in Netlify dashboard, never hardcoded)
const defaultConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  databaseURL: process.env.VITE_FIREBASE_DATABASE_URL || "",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.VITE_FIREBASE_APP_ID || "",
};

let cachedDb: Firestore | null = null;

export const saveFirebaseConfig = (config: any) => {
  try {
    localStorage.setItem(STORAGE_KEY_FB, JSON.stringify(config));
    window.location.reload();
  } catch (e) {
    console.error("Failed to save config", e);
  }
};

export function initFirebaseFromLocalStorage(): { ok: boolean; db?: Firestore; error?: string } {
  if (cachedDb) return { ok: true, db: cachedDb };

  try {
    let config = defaultConfig;
    const stored = localStorage.getItem(STORAGE_KEY_FB);
    if (stored) {
      try {
        config = JSON.parse(stored);
      } catch (e) {}
    }

    if (!config.apiKey || config.apiKey === "PASTE_YOUR_API_KEY_HERE") {
      return { ok: false, error: "No API Key Configured" };
    }

    let app: any;
    const fb = firebaseApp as any;
    const getApps = fb.getApps || (fb.default && fb.default.getApps);
    const getApp = fb.getApp || (fb.default && fb.default.getApp);
    const initializeApp = fb.initializeApp || (fb.default && fb.default.initializeApp);

    if (!initializeApp) {
      throw new Error("Firebase initializeApp not found in import");
    }

    if (getApps && getApps().length > 0) {
      app = getApp();
    } else {
      app = initializeApp(config);
    }

    try {
      cachedDb = getFirestore(app);
      console.log("🔥 Firebase Firestore Client Retrieved");
      return { ok: true, db: cachedDb };
    } catch (innerErr: any) {
      console.warn("⚠️ Firestore init failed. Defaulting to Local Storage.", innerErr.message);
      return { ok: false, error: innerErr.message };
    }

  } catch (e: any) {
    console.warn("Firebase Init Error (Defaulting to Local Storage):", e);
    return { ok: false, error: e.message || "Unknown Firebase Error" };
  }
}

export async function validateConnection(db: Firestore): Promise<void> {
  try {
    const q = query(collection(db, "jobs"), limit(1));
    await getDocs(q);
    console.log("✅ Firestore Connection Verified (Read Success)");
  } catch (e: any) {
    console.warn("❌ Firestore Connection Check Failed (will use Local Storage):", e);
    throw e;
  }
}