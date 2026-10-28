# יחד בסל

רשימת קניות משותפת לכל הבית, עם התראות Push לכל מי שברשימה:

- **הוספת פריטים מגיעה בהתראה אחת.** כשמישהו מוסיף כמה פריטים, שאר בני הבית מקבלים התראה אחת עם כולם ("דנה הוסיפה 4 פריטים: חלב, ביצים…"). ההתראה יוצאת אחרי דקה בלי הוספות, ולכל היותר 5 דקות אחרי הפריט הראשון.
- **"אני בסופר".** כפתור שמודיע לכולם שיצאת לקניות. בזמן הזה כל פריט שמתווסף נשלח מיד, ומסומן אצל הקונה בתגית "חדש".
- **זיהוי הגעה לפי מיקום.** שומרים בהגדרות הרשימה את הסופרים הקבועים. כשהאפליקציה פתוחה וקרובים לאחד מהם, היא מציעה להודיע לכולם. המיקום לא נשמר ולא נשלח לשום מקום.
- **סיכום קנייה.** בסוף הקנייה כולם מקבלים מה נקנה, מה נשאר ברשימה, וכמה זמן זה לקח.
- הפריטים ממוינים אוטומטית לפי מחלקות בסופר. מזמינים בני בית בקישור בוואטסאפ או בקוד בן 6 תווים.

הבנייה זהה לאפליקציית "הוצאות הבית": Supabase בסכמה נפרדת בתוך פרויקט קיים, כניסה עם אימייל וסיסמה, אתר ב-Cloudflare Pages, ו-APK לאנדרואיד.

## איך זה בנוי

| חלק | טכנולוגיה | איפה |
| --- | --- | --- |
| אפליקציה | React + Vite, PWA | `src/` |
| נתונים, כניסה וסנכרון חי | Supabase (סכמה `yachad`) | `supabase/migrations/` |
| קיבוץ הוספות | טריגר ב-Postgres ו-`pg_cron` כל דקה | אותו קובץ migration |
| שליחת Push | Web Push רגיל (VAPID), מ-Edge Function | `supabase/functions/send-push/` |
| אנדרואיד | Trusted Web Activity: האתר רץ בתוך Chrome במסך מלא, ולכן ה-Push עובד | `android/` |

כך התראה מגיעה לטלפון: פריט חדש נכנס ל-`pending_batches`. אחרי דקה בלי הוספות, `flush_batches` יוצר אירוע ב-`events`. הטריגר `dispatch_push` קורא (דרך `pg_net`) לפונקציה `send-push`, והיא שולחת Web Push לכל המכשירים של שאר בני הבית. מכשיר שהסיר את האפליקציה נמחק אוטומטית. אין שירות חיצוני מעבר ל-Supabase.

## הקמה (פעם אחת, בערך 20 דקות)

### שלב 1: Supabase

אפשר להשתמש באותו פרויקט של "הוצאות הבית". הסקריפט יוצר רק את הסכמה `yachad`, ולא נוגע בשום דבר אחר.

1. **Database › Extensions**: מפעילים את `pg_cron` ואת `pg_net`.
2. **SQL Editor › New query**: מדביקים את כל התוכן של `supabase/migrations/20261028080000_init.sql` ולוחצים **Run**.
3. **Project Settings › Data API › Exposed schemas**: מוסיפים את `yachad`.
4. **Authentication › URL Configuration › Redirect URLs**: מוסיפים `https://yachad-basal.pages.dev/**`. את ה-Site URL לא משנים.
5. יוצרים מפתחות VAPID (פעם אחת): `npx web-push generate-vapid-keys`.
6. מעלים את פונקציית השליחה ומגדירים לה סודות. בסוד `PUSH_WEBHOOK_SECRET` שמים מחרוזת אקראית ארוכה:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com PUSH_WEBHOOK_SECRET=...
   npx supabase functions deploy send-push --no-verify-jwt
   ```
7. ב-**SQL Editor**, כדי שמסד הנתונים יידע לאן לקרוא:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<אותו PUSH_WEBHOOK_SECRET>', 'push_webhook_secret');
   ```

### שלב 2: האתר ב-Cloudflare Pages

1. ממלאים את `.env.local` לפי `.env.example`: Project URL, המפתח anon/publishable (לא את ה-service_role!), ו-VAPID_PUBLIC_KEY.
2. `npm install && npm run deploy`. הפקודה בונה את האתר ומעלה אותו לפרויקט `yachad-basal` ב-Cloudflare Pages.
   אפשר גם בלי שורת פקודה: `npm run build`, ואז מעלים את תוכן התיקייה `dist` ב-**Workers & Pages › Create › Pages › Upload assets**.
3. בדיקה: הכתובת `https://yachad-basal.pages.dev/.well-known/assetlinks.json` צריכה להציג טקסט.

אם השם `yachad-basal` תפוס ב-Cloudflare, בונים מחדש את ה-APK לכתובת שהתקבלה: `SITE_HOST=<השם>.pages.dev npm run apk`, ומעלים שוב.

### שלב 3: התקנה בטלפון

- **אנדרואיד:** ב-Chrome נכנסים ל-`https://yachad-basal.pages.dev/yachad-basal.apk`, מורידים ומתקינים. אם מופיעה אזהרה של Play Protect: **פרטים נוספים › להתקין בכל זאת**. אפשר גם לפתוח את האתר ב-Chrome ולבחור "הוספה למסך הבית".
- **אייפון:** פותחים את האתר ב-Safari, ואז שיתוף › **הוספה למסך הבית**. התראות באייפון עובדות רק מ-iOS 16.4 ואילך, ורק מהאייקון שבמסך הבית.
- בפעם הראשונה ברשימה לוחצים **הפעלה** בפס ההתראות.

## פיתוח מקומי

```bash
npm install
npm run db:start        # Supabase מקומי (צריך Docker). מדפיס API URL ומפתח publishable
# מעתיקים אותם ל-.env.local כ-VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

בדיקות: `npm test` (מיון למחלקות, חישוב מרחק, ונוסחי ההתראות).

בניית ה-APK: `npm run apk`. צריך את החבילות `aapt apksigner zipalign android-sdk-platform-23 dalvik-exchange` ו-JDK. בבנייה הראשונה נוצר מפתח חתימה ב-`android/signing/`. **שומרים אותו בצד** כי בלעדיו אי אפשר לעדכן את ה-APK, **ולא מעלים אותו ל-GitHub**. הוא כבר מוחרג ב-`.gitignore`.

## כדאי לדעת

- **עדכונים** לאפליקציה מגיעים מ-Cloudflare לכל הטלפונים לבד. צריך לבנות APK חדש רק אם משנים את הכתובת.
- **ההתראות באנדרואיד** מוצגות בשם האתר, דרך Chrome. בטלפון צריך Chrome מעודכן, וכמעט תמיד הוא כבר מותקן.
- **פרויקט חינמי ב-Supabase נכנס להשהיה** אחרי שבוע בלי שימוש. אם זה קרה, נכנסים ל-supabase.com ולוחצים Restore.
- **זיהוי הגעה ברקע,** כשהאפליקציה סגורה, דורש אפליקציה נייטיב. כרגע הזיהוי עובד רק כשהאפליקציה פתוחה.
- **הרשאות:** כל משתמש רואה רק רשימות שהוא חבר בהן. מצטרפים רק עם קוד הזמנה, ורק בעלי הרשימה יכולים למחוק אותה.
