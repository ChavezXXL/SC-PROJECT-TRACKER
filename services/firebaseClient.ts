import { getFirestore, Firestore, collection, getDocs, query, limit } from "firebase/firestore";

// Workaround for environments where named exports from firebase/app are not detected correctly
import * as firebaseApp from "firebase/app";

const STORAGE_KEY_FB = 'nexus_firebase_config';

const defaultConfig = {
  apiKey: "AIzaSyChOewBMJeW3oAM4KYn6ergrGIV9bPHTC8",
  authDomain: "sc-job-tracker.firebaseapp.com",
  databaseURL: "https://sc-job-tracker-default-rtdb.firebaseio.com",
  projectId: "sc-job-tracker",
  storageBucket: "sc-job-tracker.firebasestorage.app",
  messagingSenderId: "29160179130",
  appId: "1:29160179130:web:32b55040b011bc316f4983"
};

let cachedDb: Firestore | null = null;

export const saveFirebaseConfig = (config: any) => {
    try {
        localStorage.setItem(STORAGE_KEY_FB, JSON.stringify(config));
        // Reload to force re-initialization with new config
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

        // Basic validation
        if (!config.apiKey || config.apiKey === "PASTE_YOUR_API_KEY_HERE") {
             return { ok: false, error: "No API Key Configured" };
        }

        let app: any;
        
        // Access firebaseApp members safely. Cast to any to bypass TS check if definition is incomplete.
        const fb = firebaseApp as any;

        // Helper to find the app instance or functions
        // Checks both named exports (v9) and default export (compat/v8 style or interop)
        const getApps = fb.getApps || (fb.default && fb.default.getApps);
        const getApp = fb.getApp || (fb.default && fb.default.getApp);
        const initializeApp = fb.initializeApp || (fb.default && fb.default.initializeApp);

        if (!initializeApp) {
             throw new Error("Firebase initializeApp not found in import");
        }

        // Use standard check for existing apps
        if (getApps && getApps().length > 0) {
            app = getApp();
        } else {
            app = initializeApp(config);
        }

        // Safely attempt to get Firestore
        // In sandboxes, this might fail due to network restrictions or CSP.
        // We catch it and return ok:false so the app falls back to Local Storage.
        try {
            cachedDb = getFirestore(app);
            console.log("🔥 Firebase Firestore Client Retrieved");
            return { ok: true, db: cachedDb };
        } catch (innerErr: any) {
             console.warn("⚠️ Firestore init failed (likely sandbox environment). Defaulting to Local Storage.", innerErr.message);
             return { ok: false, error: innerErr.message };
        }

    } catch (e: any) {
        console.warn("Firebase Init Error (Defaulting to Local Storage):", e);
        return { ok: false, error: e.message || "Unknown Firebase Error" };
    }
}

/**
 * Performs a real read operation to verify Firestore access and permissions.
 */
export async function validateConnection(db: Firestore): Promise<void> {
    try {
        // Attempt to read from a standard collection with limit 1
        const q = query(collection(db, "jobs"), limit(1));
        await getDocs(q);
        console.log("✅ Firestore Connection Verified (Read Success)");
    } catch (e: any) {
        console.warn("❌ Firestore Connection Check Failed (will use Local Storage):", e);
        throw e;
    }
}