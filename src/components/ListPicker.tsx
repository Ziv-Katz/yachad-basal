import { useState } from "react";
import { createList, ensureProfile, joinList, type List } from "../lib/data";
import { useToast } from "./Toasts";

export function ListPicker({ uid, myName, lists, onOpen, onSignOut }: {
  uid: string; myName: string; lists: List[]; onOpen: (id: string) => void; onSignOut: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("הבית");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string>, fail: string) => {
    setBusy(true);
    try { await ensureProfile(myName); onOpen(await fn()); }
    catch (e) { toast(fail, (e as Error).message === "not-found" ? "לא מצאתי רשימה עם הקוד הזה." : "נסו שוב בעוד רגע."); }
    finally { setBusy(false); }
  };

  return (
    <div className="wrap">
      <header>
        <div><h1>יחד בסל</h1><p className="sub">שלום {myName || "לך"}</p></div>
        <button onClick={onSignOut}>התנתקות</button>
      </header>

      {lists.length > 0 && (
        <section className="card">
          <h2 className="h2">הרשימות שלי</h2>
          <ul className="plain">
            {lists.map((l) => (
              <li key={l.id}><button className="rowbtn" onClick={() => onOpen(l.id)}>
                <span className="name">{l.name}</span>
                <span className="by">{l.members.length} משתתפים{l.trip?.active ? " · מישהו בסופר עכשיו" : ""}</span>
              </button></li>
            ))}
          </ul>
        </section>
      )}

      <form className="card" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(() => createList(uid, name.trim()), "הרשימה לא נוצרה"); }}>
        <h2 className="h2">רשימה חדשה</h2>
        <div className="add">
          <input id="newListName" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="שם הרשימה" />
          <button className="primary" disabled={busy}>יצירה</button>
        </div>
      </form>

      <form className="card" onSubmit={(e) => { e.preventDefault(); if (code.trim()) run(() => joinList(code.trim()), "ההצטרפות לא הצליחה"); }}>
        <h2 className="h2">הצטרפות לרשימה קיימת</h2>
        <p className="sub">קיבלתם קישור בוואטסאפ? פשוט לוחצים עליו. אפשר גם להקליד את הקוד בן 6 התווים.</p>
        <div className="add">
          <input id="joinCode" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="למשל K7M2QX" aria-label="קוד הזמנה" dir="ltr" />
          <button className="primary" disabled={busy}>הצטרפות</button>
        </div>
      </form>
    </div>
  );
}
