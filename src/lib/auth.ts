// Las sesiones se guardan en una cookie HttpOnly. Solo retiramos el token
// antiguo de versiones previas para que no mantenga una sesión obsoleta.
const LEGACY_TOKEN_KEY = "dashboard_token";

export function clearLegacyToken() {
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export function handleUnauthorized() {
  clearLegacyToken();
  if (!window.location.pathname.startsWith("/login")) {
    window.location.reload();
  }
}
