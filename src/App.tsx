import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configured, sb } from "./lib/supabase";
import { ensureProfile, joinList, useLists } from "./lib/data";
import { refreshPushSubscription } from "./lib/push";
import { ToastProvider, useToast } from "./components/Toasts";
import { ListPicker } from "./components/ListPicker";
import { ListView } from "./components/ListView";
import { Auth } from "./components/Auth";

/** Invite links look like https://…/#join=K7M2QX (same pattern as the expenses app). */
export const inviteCodeFromHash = () => /^#join=([A-Z0-9]{6})$/i.exec(location.hash)?.[1]?.toUpperCase() ?? null;

export default function App() {
  return <ToastProvider><Shell /></ToastProvider>;
}

function Shell() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) return <div className="wrap"><h1>יחד בסל</h1><div className="notice">חסרים פרטי החיבור ל-Supabase. ממלאים את ‎.env.local‎ לפי ה-README.</div></div>;
  if (session === undefined) return <div className="wrap"><p className="sub">טוען…</p></div>;
  if (!session || recovery) return <Auth mode={recovery ? "newpass" : undefined} onDone={() => setRecovery(false)} />;
  return <Home session={session} />;
}

function Home({ session }: { session: Session }) {
  const toast = useToast();
  const uid = session.user.id;
  const myName = (session.user.user_metadata?.name as string) ?? "";
  const [lists, refreshLists] = useLists(uid);
  const [listId, setListId] = useState<string | null>(() => new URLSearchParams(location.search).get("list"));

  useEffect(() => {
    ensureProfile(myName).catch(() => {});
    refreshPushSubscription();
  }, [myName]);

  // Opened from an invite link: join right away.
  useEffect(() => {
    const code = inviteCodeFromHash();
    if (!code) return;
    history.replaceState(null, "", location.pathname + location.search);
    ensureProfile(myName)
      .then(() => joinList(code))
      .then((id) => { refreshLists(); setListId(id); toast("הצטרפת לרשימה"); })
      .catch((e) => toast("ההצטרפות לא הצליחה", e.message === "not-found" ? "הקוד בקישור לא נמצא. בקשו קישור חדש." : "נסו שוב בעוד רגע."));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the only list straight away; fall back to the picker if the chosen list is gone.
  useEffect(() => {
    if (!lists) return;
    if (listId && !lists.some((l) => l.id === listId)) setListId(null);
    else if (!listId && lists.length === 1) setListId(lists[0].id);
  }, [lists, listId]);

  const list = lists?.find((l) => l.id === listId);
  if (!lists) return <div className="wrap"><p className="sub">טוען את הרשימות…</p></div>;
  if (list) return <ListView key={list.id} list={list} uid={uid} onBack={() => setListId(null)} />;
  return <ListPicker uid={uid} myName={myName} lists={lists} onOpen={(id) => { refreshLists(); setListId(id); }} onSignOut={() => sb.auth.signOut()} />;
}
