import { useEffect, useMemo, useState } from "react";
import {
  addItem, clearDone, endTrip, leaveList, removeItem, saveStores, startTrip, toggleItem, useEvents, useItems,
  type Item, type List, type ListEvent,
} from "../lib/data";
import { AISLE_ORDER } from "../lib/aisles";
import { enablePush, pushState, type PushState } from "../lib/push";
import { nearestStore, type Store } from "../lib/geo";
import { useToast } from "./Toasts";

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const rel = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.round(m / 60);
  return h < 24 ? `לפני ${h} שע׳` : new Date(t).toLocaleDateString("he-IL");
};

export function ListView({ list, uid, onBack }: { list: List; uid: string; onBack?: () => void }) {
  const toast = useToast();
  const items = useItems(list.id);
  const events = useEvents(list.id);
  const me = uid;
  const nm = (id?: string | null) => (id === me ? "את/ה" : (id && list.memberNames[id]) || "מישהו מהבית");

  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [lastSeen, setLastSeen] = useState(() => Number(store.get(`yb-seen-${list.id}`) || 0));
  const [push, setPush] = useState<PushState | null>(null);
  const [arrivedAt, setArrivedAt] = useState<Store | null>(null);
  const [, tick] = useState(0);

  useEffect(() => { pushState().then(setPush); }, []);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  const trip = list.trip?.active ? list.trip : null;
  const mineTrip = trip?.shopperId === me;
  const unread = events.filter((e) => e.at > lastSeen && e.by !== me).length;

  // Arrival detection: only while the app is open, only if this person turned it on, only when nobody is already shopping.
  const geoOn = store.get("yb-geo") === "1";
  useEffect(() => {
    if (!geoOn || trip || !list.stores.length || !("geolocation" in navigator)) { setArrivedAt(null); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const s = nearestStore({ lat: p.coords.latitude, lng: p.coords.longitude }, list.stores);
        const dismissed = store.get(`yb-dismiss-${list.id}`) === new Date().toDateString();
        setArrivedAt(s && !dismissed ? s : null);
      },
      () => setArrivedAt(null),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [geoOn, trip, list.stores, list.id]);

  const groups = useMemo(() => {
    const g = new Map<string, Item[]>();
    for (const it of items ?? []) g.set(it.aisle, [...(g.get(it.aisle) ?? []), it]);
    for (const arr of g.values()) arr.sort((a, b) => Number(a.done) - Number(b.done) || a.at - b.at);
    return AISLE_ORDER.filter((a) => g.has(a)).map((a) => [a, g.get(a)!] as const);
  }, [items]);

  const left = items?.filter((i) => !i.done).length ?? 0;
  const done = (items?.length ?? 0) - left;
  const fresh = trip ? items?.filter((i) => !i.done && i.at > trip.startedAt).length ?? 0 : 0;

  const fail = (what: string) => () => toast(what, "נסו שוב בעוד רגע.");

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    addItem(list.id, me, n, qty.trim()).catch(fail("הפריט לא נשמר"));
    setName(""); setQty("");
  };

  const onStart = (s: Store | null = null) => { setArrivedAt(null); startTrip(list.id, me, s?.name ?? null).catch(fail("לא הצלחתי לעדכן את כולם")); };
  const onEnd = async () => {
    try { const r = await endTrip(list, items ?? [], me); toast("הסיכום נשלח לכולם", `${r.bought} נקנו, ${r.missing} נשארו ברשימה.`); }
    catch { fail("הסיכום לא נשלח")(); }
  };

  const closeDrawer = () => { setDrawer(false); const now = Date.now(); setLastSeen(now); store.set(`yb-seen-${list.id}`, String(now)); };

  return (
    <div className="wrap">
      <header>
        <div>
          <button className="link" onClick={onBack}>→ כל הרשימות</button>
          <h1>{list.name}</h1>
          <p className="sub">{list.members.length > 1 ? `${list.members.length} משתתפים` : "רק את/ה כרגע. הזמינו את בני הבית בהגדרות."}</p>
        </div>
        <div className="row">
          <button onClick={() => setSettings(true)}>הגדרות</button>
          <button className="bell" onClick={() => setDrawer(true)} aria-label={`התראות, ${unread} חדשות`}>
            התראות{unread > 0 && <span className="badge">{unread}</span>}
          </button>
        </div>
      </header>

      {push === "default" && (
        <div className="notice row-between">
          <span>הפעילו התראות כדי לדעת כשמוסיפים פריטים או כשמישהו בסופר.</span>
          <button className="primary" onClick={async () => setPush(await enablePush().catch(() => "denied" as const))}>הפעלה</button>
        </div>
      )}
      {push === "needs-install" && <div className="notice">באייפון, התראות עובדות רק אחרי שמוסיפים את האפליקציה למסך הבית: כפתור השיתוף ב-Safari ואז "הוספה למסך הבית".</div>}
      {push === "denied" && <div className="notice">ההתראות חסומות בדפדפן. אפשר להפעיל אותן מחדש בהגדרות האתר.</div>}

      {arrivedAt && (
        <div className="trip live">
          <strong>נראה שהגעת ל{arrivedAt.name}</strong>
          <p>להודיע לכולם שאת/ה בסופר, כדי שיספיקו להוסיף מה שחסר?</p>
          <div className="row">
            <button className="danger" onClick={() => onStart(arrivedAt)}>כן, להודיע</button>
            <button onClick={() => { store.set(`yb-dismiss-${list.id}`, new Date().toDateString()); setArrivedAt(null); }}>לא היום</button>
          </div>
        </div>
      )}

      <section className={`trip${trip ? " live" : ""}`} aria-live="polite">
        {trip ? (
          <>
            <strong>{mineTrip ? "את/ה בסופר עכשיו" : `${nm(trip.shopperId)} ${trip.storeName ? `ב${trip.storeName}` : "בסופר"} עכשיו`}</strong>
            <p>{mineTrip
              ? `נשארו ${left} פריטים${fresh ? `, ${fresh} מהם נוספו מאז שהגעת` : ""}. כל פריט שיתווסף עכשיו יגיע אליך מיד.`
              : `יצא/ה ${rel(trip.startedAt)}. זה הזמן להוסיף מה שחסר, ההתראה תישלח מיד.`}</p>
            {mineTrip && <div className="row"><button className="danger" onClick={onEnd}>סיימתי, שלח סיכום</button></div>}
          </>
        ) : (
          <>
            <strong>יוצאים לקניות?</strong>
            <p>לחיצה תודיע לכל מי שברשימה שאת/ה בסופר, כדי שיספיקו להוסיף דברים.</p>
            <div className="row"><button className="primary" onClick={() => onStart()}>אני בסופר</button></div>
          </>
        )}
      </section>

      <form className="add" onSubmit={onAdd} autoComplete="off">
        <input id="item" value={name} onChange={(e) => setName(e.target.value)} placeholder="מה חסר? למשל: חלב 3%" aria-label="פריט" maxLength={60} />
        <input id="qty" className="qty-in" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="כמות" aria-label="כמות" maxLength={8} />
        <button className="primary">הוספה</button>
      </form>

      {items === null ? <div className="empty">טוען את הרשימה…</div>
        : items.length === 0 ? <div className="empty">הרשימה ריקה. הוסיפו את הפריט הראשון, וכל מי שברשימה יקבל עדכון.</div>
        : groups.map(([aisle, arr]) => (
          <section className="aisle" key={aisle}>
            <h2>{aisle}</h2>
            <ul>
              {arr.map((it) => (
                <li key={it.id} className={it.done ? "done" : ""}>
                  <button className="check" onClick={() => toggleItem(list.id, it, me).catch(fail("הסימון לא נשמר"))}
                    aria-label={it.done ? `בטל סימון ${it.name}` : `סמן ${it.name} כנקנה`}>{it.done ? "✓" : ""}</button>
                  <div className="meta">
                    <div className="name">{it.name}{trip && !it.done && it.at > trip.startedAt && <span className="chip">חדש</span>}</div>
                    <div className="by">{it.done ? it.doneBy === me ? "נקנה על ידך" : `נקנה ע״י ${nm(it.doneBy)}` : `${nm(it.by)} · ${rel(it.at)}`}</div>
                  </div>
                  {it.qty && <span className="qty">{it.qty}</span>}
                  <button className="x" onClick={() => removeItem(list.id, it.id).catch(fail("המחיקה לא הצליחה"))} aria-label={`מחק ${it.name}`}>×</button>
                </li>
              ))}
            </ul>
          </section>
        ))}

      {!!items?.length && (
        <div className="foot">
          <span>{left} לקנות · {done} נקנו</span>
          {confirmClear ? (
            <span className="row">
              <span>למחוק את כל מה שנקנה?</span>
              <button className="danger" onClick={() => { clearDone(list.id).catch(fail("המחיקה לא הצליחה")); setConfirmClear(false); }}>מחיקה</button>
              <button onClick={() => setConfirmClear(false)}>ביטול</button>
            </span>
          ) : <button disabled={!done} onClick={() => setConfirmClear(true)}>ניקוי פריטים שנקנו</button>}
        </div>
      )}

      {drawer && (
        <Sheet title="התראות" onClose={closeDrawer}>
          {events.length === 0 && <div className="empty">עוד אין התראות. כשמישהו יוסיף פריטים או יגיע לסופר, זה יופיע כאן.</div>}
          {events.map((e) => <EventCard key={e.id} e={e} nm={nm} mine={e.by === me} unread={e.at > lastSeen && e.by !== me} />)}
        </Sheet>
      )}

      {settings && <Settings list={list} me={me} onClose={() => setSettings(false)} onLeft={onBack} />}
    </div>
  );
}

function EventCard({ e, nm, mine, unread }: { e: ListEvent; nm: (id: string) => string; mine: boolean; unread: boolean }) {
  let title = "", body = "";
  if (e.type === "added") { const n = e.items?.length ?? 0; const what = n === 1 ? "פריט" : `${n} פריטים`; title = mine ? `הוספת ${what}` : `${nm(e.by)} הוסיף/ה ${what}`; body = e.items?.join(", ") ?? ""; }
  if (e.type === "at_store") { title = `${nm(e.by)} ${e.storeName ? `ב${e.storeName}` : "בסופר"}`; body = "חסר משהו? זה הזמן להוסיף."; }
  if (e.type === "summary") {
    title = mine ? "סיימת את הקנייה" : `${nm(e.by)} סיים/ה את הקנייה`;
    body = [`נקנו ${e.bought?.length ?? 0}${e.bought?.length ? `: ${e.bought.join(", ")}` : ""}`,
      e.missing?.length ? `נשארו ${e.missing.length}: ${e.missing.join(", ")}` : "",
      `משך הקנייה: ${e.minutes} דק׳`].filter(Boolean).join("\n");
  }
  return <div className={`ev${unread ? " unread" : ""}`}><span className="t">{rel(e.at)}</span><span className="k">{title}</span>{body && <span className="pre">{body}</span>}</div>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="drawer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="panel" role="dialog" aria-label={title}>
        <div className="row-between"><h3>{title}</h3><button onClick={onClose}>סגירה</button></div>
        {children}
      </aside>
    </div>
  );
}

function Settings({ list, me, onClose, onLeft }: { list: List; me: string; onClose: () => void; onLeft?: () => void }) {
  const toast = useToast();
  const [storeName, setStoreName] = useState("");
  const [geo, setGeo] = useState(store.get("yb-geo") === "1");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const stores = list.stores;

  const inviteUrl = `${location.origin}/#join=${list.inviteCode}`;
  const inviteText = `מצטרפים לרשימת הקניות "${list.name}" ביחד בסל:\n${inviteUrl}\n(או מזינים באפליקציה את הקוד ${list.inviteCode})`;
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ text: inviteText }); return; } catch { /* cancelled */ } }
    window.open(`https://wa.me/?text=${encodeURIComponent(inviteText)}`, "_blank");
  };
  const copy = () => navigator.clipboard?.writeText(list.inviteCode).then(() => toast("הקוד הועתק"), () => {});

  const addHere = () => {
    if (!storeName.trim()) return toast("תנו שם לסופר", "למשל: שופרסל דיל ברחוב הרצל");
    navigator.geolocation.getCurrentPosition(
      (p) => saveStores(list.id, [...stores, { name: storeName.trim(), lat: p.coords.latitude, lng: p.coords.longitude }])
        .then(() => { setStoreName(""); toast("הסופר נשמר", "כשתגיעו לשם עם האפליקציה פתוחה, נציע להודיע לכולם."); }, () => toast("הסופר לא נשמר")),
      () => toast("אין גישה למיקום", "אשרו גישה למיקום בדפדפן ונסו שוב."),
      { enableHighAccuracy: true, timeout: 20000 },
    );
  };

  return (
    <Sheet title="הגדרות הרשימה" onClose={onClose}>
      <section className="card">
        <h4>הזמנת בני הבית</h4>
        <p className="sub">שלחו להם קישור בוואטסאפ. מי שלוחץ עליו נכנס או נרשם, ומצטרף לרשימה מיד. אפשר גם להקליד את הקוד.</p>
        <div className="row-between"><span className="code" dir="ltr">{list.inviteCode}</span><span className="row"><button onClick={copy}>העתקה</button><button className="primary" onClick={share}>שליחה בוואטסאפ</button></span></div>
      </section>

      <section className="card">
        <h4>משתתפים</h4>
        <ul className="plain">{list.members.map((m) => <li key={m}>{list.memberNames[m] || "ללא שם"}{m === me && " (את/ה)"}</li>)}</ul>
      </section>

      <section className="card">
        <h4>זיהוי הגעה לסופר</h4>
        <p className="sub">כשהאפליקציה פתוחה ואת/ה ליד אחד הסופרים השמורים, נציע להודיע לכולם. המיקום לא נשמר ולא נשלח לאף אחד.</p>
        <label className="toggle"><input id="geoToggle" type="checkbox" checked={geo} onChange={(e) => { setGeo(e.target.checked); store.set("yb-geo", e.target.checked ? "1" : "0"); }} /> להפעיל במכשיר הזה</label>
        <ul className="plain">{stores.map((s, i) => (
          <li key={i} className="row-between"><span>{s.name}</span>
            <button className="x" aria-label={`מחק ${s.name}`} onClick={() => saveStores(list.id, stores.filter((_, j) => j !== i))}>×</button></li>
        ))}</ul>
        <div className="add">
          <input id="storeName" value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="שם הסופר" aria-label="שם הסופר" maxLength={30} />
          <button onClick={addHere}>אני כאן עכשיו</button>
        </div>
      </section>

      <section className="card">
        {confirmLeave ? (
          <div className="row"><span>לעזוב את הרשימה?</span>
            <button className="danger" onClick={() => leaveList(list, me).then(() => { onClose(); onLeft?.(); }, () => toast("לא הצלחתי לעזוב"))}>עזיבה</button>
            <button onClick={() => setConfirmLeave(false)}>ביטול</button></div>
        ) : <button onClick={() => setConfirmLeave(true)}>עזיבת הרשימה</button>}
      </section>
    </Sheet>
  );
}
