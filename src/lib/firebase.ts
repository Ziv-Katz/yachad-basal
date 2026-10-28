import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, persistentLocalCache } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Local development against `firebase emulators:start` (see README). */
export const useEmulators = import.meta.env.VITE_USE_EMULATORS === "true";

export const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export const app = initializeApp(configured ? firebaseConfig : { apiKey: "missing", projectId: "missing", appId: "missing" });
export const auth = getAuth(app);
// Offline cache so the list opens in the store even with weak reception.
export const db = initializeFirestore(app, { localCache: useEmulators ? memoryLocalCache() : persistentLocalCache() });
export const functions = getFunctions(app, "europe-west1");
export const googleProvider = new GoogleAuthProvider();

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
