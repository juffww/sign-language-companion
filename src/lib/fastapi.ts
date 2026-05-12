// FastAPI backend configuration.
// Set VITE_FASTAPI_URL in .env (e.g. https://xxx.trycloudflare.com).
// During development you can also override per-user via localStorage 'fastapi_url'.

export function getFastApiUrl(): string {
  if (typeof window !== "undefined") {
    const ls = localStorage.getItem("fastapi_url");
    if (ls) return ls.replace(/\/$/, "");
  }
  return (import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000").replace(/\/$/, "");
}

export function getFastApiWsUrl(): string {
  const url = getFastApiUrl();
  return url.replace(/^http/, "ws");
}

export function setFastApiUrl(url: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("fastapi_url", url.replace(/\/$/, ""));
  }
}
