import { useState } from "react";
import { Lock } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface LoginProps {
  migrationRequired: boolean;
  onSuccess: () => void;
}

export default function Login({ migrationRequired, onSuccess }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await api.login(email, password);
    setLoading(false);
    if (res.success && res.data?.user) {
      onSuccess();
    } else {
      setError(res.error || "Contraseña incorrecta");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <CardTitle className="text-lg">Acceso al dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              {!migrationRequired && <>
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@restaurante.com"
                />
              </>}
              <Label htmlFor="password">{migrationRequired ? 'Contraseña actual' : 'Contraseña'}</Label>
              <Input
                id="password"
                type="password"
                autoFocus={migrationRequired}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Introduce la contraseña"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {migrationRequired && (
              <p className="text-xs text-muted-foreground">
                Acceso provisional. Crea tu cuenta individual desde el botón de usuarios al entrar.
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading || !password}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
