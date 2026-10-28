import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Toast = { id: number; title: string; body?: string };
const Ctx = createContext<(title: string, body?: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div className="toast" key={t.id}><b>{t.title}</b>{t.body && <span>{t.body}</span>}</div>)}
      </div>
    </Ctx.Provider>
  );
}
