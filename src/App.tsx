import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth, configured, googleProvider, useEmulators } from "./lib/firebase";
import { saveProfile, useLists } from "./lib/data";
import { onForegroundAlert } from "./lib/push";
import { ToastProvider, useToast } from "./components/Toasts";
import { ListPicker } from "./components/ListPicker";
import { ListView } from "./components/ListView";

export default function App() {
  return <ToastProvider><Shell /></ToastProvider>;
}

function Shell() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    if (u) saveProfile(u.uid, u.displayName ?? "").catch(() => {});
  }), []);

  if (!configured) return <Setup />;
  if (user === undefined) return <div className="wrap"><p className="sub">טוען…</p></div>;
  if (!user) return <SignIn />;
  return <Home user={user} />;
}

function Home({ user }: { user: User }) {
  const toast = useToast();
  const lists = useLists(user.uid);
  const [listId, setListId] = useState<string | null>(() => new URLSearchParams(location.search).get("list"));

  useEffect(() => {
    let off = () => {};
    onForegroundAlert((t, b) => toast(t, b)).then((f) => (off = f));
    return () => off();
  }, [toast]);

  // Open the only list straight away; fall back to the picker if the chosen list is gone.
  useEffect(() => {
    if (!lists) return;
    if (listId && !lists.some((l) => l.id === listId)) setListId(null);
    else if (!listId && lists.length === 1) setListId(lists[0].id);
  }, [lists, listId]);

  const list = lists?.find((l) => l.id === listId);
  if (!lists) return <div className="wrap"><p className="sub">טוען את הרשימות…</p></div>;
  if (list) return <ListView key={list.id} list={list} user={user} onBack={lists.length > 1 ? () => setListId(null) : undefined} />;
  return <ListPicker user={user} lists={lists} onOpen={setListId} onSignOut={() => signOut(auth)} />;
}

function SignIn() {
  const [err, setErr] = useState("");
  return (
    <div className="wrap center">
      <h1>יחד בסל</h1>
      <p className="lead">רשימת קניות אחת לכל הבית. כשמישהו מוסיף פריטים או מגיע לסופר, כולם יודעים.</p>
      <button className="primary big" onClick={() => signInWithPopup(auth, googleProvider).catch(() => setErr("ההתחברות לא הושלמה. נסו שוב."))}>
        התחברות עם Google
      </button>
      {err && <p className="error">{err}</p>}
      {useEmulators && (
        <div className="row">
          {["דנה", "יואב"].map((n, i) => (
            <button key={n} onClick={() => signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: `dev-${i}`, email: `dev${i}@example.com`, name: n, email_verified: true })))}>
              כניסת בדיקה: {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Setup() {
  return (
    <div className="wrap">
      <h1>יחד בסל</h1>
      <div className="notice">חסרים פרטי החיבור ל-Firebase. העתיקו את ‎.env.example‎ ל-‎.env.local‎ ומלאו את הערכים לפי ה-README.</div>
    </div>
  );
}
