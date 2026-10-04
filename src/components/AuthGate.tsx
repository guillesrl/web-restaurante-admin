import { createContext, useContext, useEffect, useState } from "react";
import { api, DashboardUser } from "@/lib/api";
import { clearLegacyToken } from "@/lib/auth";
import Login from "@/pages/Login";
import { Skeleton } from "@/components/ui/skeleton";

interface AuthContextValue {
  user: DashboardUser | null;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useDashboardAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useDashboardAuth debe usarse dentro de AuthGate');
  return value;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "login">("loading");
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [user, setUser] = useState<DashboardUser | null>(null);

  const refreshSession = async () => {
    const res = await api.getCurrentUser();
    if (res.success && res.data?.user) {
      setUser(res.data.user);
      setState('ok');
      return;
    }
    clearLegacyToken();
    setState('login');
  };

  useEffect(() => {
    let active = true;
    api.getAuthStatus().then((res) => {
      if (!active) return;
      const enabled = res.data?.enabled ?? false;
      setMigrationRequired(res.data?.migration_required ?? false);
      if (!enabled) setState("ok");
      else refreshSession();
    });
    return () => {
      active = false;
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Skeleton className="h-40 w-full max-w-sm" />
      </div>
    );
  }

  if (state === "login") {
    return <Login migrationRequired={migrationRequired} onSuccess={refreshSession} />;
  }

  return (
    <AuthContext.Provider value={{
      user,
      logout: async () => {
        await api.logout();
        clearLegacyToken();
        setUser(null);
        setState('login');
      },
    }}>
      {children}
    </AuthContext.Provider>
  );
}
