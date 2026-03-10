import { getFirestore, Firestore, collection, getDocs, query, limit } from "firebase/firestore";
import * as firebaseApp from "firebase/app";

const STORAGE_KEY_FB = 'nexus_firebase_config';

const defaultConfig = {
    apiKey: "AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8",
    authDomain: "sc-job-tracker.firebaseapp.com",
    databaseURL: "https://sc-job-tracker-default-rtdb.firebaseio.com",
    projectId: "sc-job-tracker",
    storageBucket: "sc-job-tracker.firebasestorage.app",
    messagingSenderId: "29160179130",
    appId: "1:29160179130:web:32b55040b011bc316f4983",
};

let cachedDb = null;

export const saveFirebaseConfig = (config) => {
  try {
    localStorage.setItem(STORAGE_KEY_FB, JSON.stringify(config));
    window.location.reload();
  } catch (e) {
    console.error("Failed to save config", e);
  }
};

export function initFirebaseFromLocalStorage() {
  if (cachedDb) return { ok: true, db: cachedDb };

  try {
    let config = defaultConfig;
    const stored = localStorage.getItem(STORAGE_KEY_FB);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.apiKey) {
          config = parsed;
        }
      } catch {}
    }

    if (!config.apiKey) {
      return { ok: false, error: "No API Key Configured" };
    }

    let app;
    const fb = firebaseApp;
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
      console.log("Firebase Firestore Client Retrieved");
      return { ok: true, db: cachedDb };
    } catch (innerErr) {
      console.warn("Firestore init failed.", innerErr.message);
      return { ok: false, error: innerErr.message };
    }

  } catch (e) {
    console.warn("Firebase Init Error:", e);
    return { ok: false, error: e.message || "Unknown Firebase Error" };
  }
}

export async function validateConnection(db) {
  try {
    const q = query(collection(db, "jobs"), limit(1));
    await getDocs(q);
    console.log("Firestore Connection Verified");
  } catch (e) {
    console.warn("Firestore Connection Check Failed:", e);
  }
}
