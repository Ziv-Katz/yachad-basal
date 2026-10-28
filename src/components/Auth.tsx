import { useState } from "react";
import { sb } from "../lib/supabase";

type Mode = "signin" | "signup" | "reset" | "newpass";
const TITLES: Record<Mode, string> = { signin: "כניסה", signup: "יצירת חשבון", reset: "איפוס סיסמה", newpass: "בחירת סיסמה חדשה" };
const redirect = () => location.origin + location.pathname + location.hash;

const explain = (msg: string) =>
  /invalid login/i.test(msg) ? "האימייל או הסיסמה לא נכונים."
  : /not confirmed/i.test(msg) ? "צריך לאשר את כתובת האימייל דרך הקישור שנשלח אליך."
  : /already registered/i.test(msg) ? "כבר יש חשבון עם האימייל הזה. אפשר להיכנס איתו (גם אם נפתח באפליקציה אחרת שלנו)."
  : /password/i.test(msg) ? "הסיסמה צריכה להיות באורך 6 תווים לפחות."
  : "משהו השתבש. נסו שוב בעוד רגע.";

/** Email and password, the same accounts as the other apps in the Supabase project. */
export function Auth({ mode: initial, onDone }: { mode?: Mode; onDone?: () => void }) {
  const [mode, setMode] = useState<Mode>(initial ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name: name.trim() }, emailRedirectTo: redirect() } });
        if (error) throw error;
        if (!data.session) { setMode("signin"); setMsg("שלחנו אליך מייל לאימות הכתובת. אחרי הלחיצה על הקישור, חוזרים לכאן ונכנסים."); }
      } else if (mode === "reset") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
        if (error) throw error;
        setMsg("אם יש חשבון עם האימייל הזה, נשלח אליו קישור לבחירת סיסמה חדשה.");
      } else {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        onDone?.();
      }
    } catch (err) {
      setMsg(explain((err as Error).message));
    } finally { setBusy(false); }
  };

  return (
    <div className="wrap center">
      <h1>יחד בסל</h1>
      <p className="lead">רשימת קניות אחת לכל הבית. כשמישהו מוסיף פריטים או מגיע לסופר, כולם יודעים.</p>
      <form className="card auth" onSubmit={submit}>
        <h2 className="h2">{TITLES[mode]}</h2>
        {mode === "signup" && (
          <label>השם שיופיע לבני הבית<input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="given-name" /></label>
        )}
        {mode !== "newpass" && (
          <label>אימייל<input id="email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        )}
        {mode !== "reset" && (
          <label>סיסמה<input id="password" type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"} /></label>
        )}
        <button className="primary big" disabled={busy}>{mode === "reset" ? "שליחת קישור" : TITLES[mode]}</button>
        {msg && <p className="msg" role="status">{msg}</p>}
        <div className="row">
          {mode === "signin" && <><button type="button" className="link" onClick={() => setMode("signup")}>אין לי חשבון עדיין</button>
            <button type="button" className="link" onClick={() => setMode("reset")}>שכחתי סיסמה</button></>}
          {(mode === "signup" || mode === "reset") && <button type="button" className="link" onClick={() => setMode("signin")}>יש לי כבר חשבון</button>}
        </div>
      </form>
    </div>
  );
}
