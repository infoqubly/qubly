const TOOL_ORIGIN = "https://infoqubly.github.io";
const TOOL_URL = `${TOOL_ORIGIN}/qubly-tools/gestione-gallerie.html`;
const REPO_API = "https://api.github.com/repos/infoqubly/qubly";
const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2026-03-10",
  "User-Agent": "QUBLY-gallery-tools"
};
const CATEGORIES = new Set(["esterni", "interni", "paesaggi"]);
const MAX_BODY_BYTES = 14 * 1024 * 1024;

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function utf8base64(value) {
  return btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join(""));
}

function decodeUtf8Base64(value) {
  return new TextDecoder().decode(fromB64url(value.replace(/\s/g, "")));
}

function randomToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", TOOL_ORIGIN);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Vary", "Origin");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

async function sessionKey(env) {
  const bytes = fromB64url(env.GALLERY_SESSION_KEY || "");
  if (bytes.length !== 32) throw new Error("Gallery session key missing");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(value, env) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, await sessionKey(env), plaintext
  ));
  return `${b64url(nonce)}.${b64url(ciphertext)}`;
}

async function unseal(value, env) {
  const [nonce, ciphertext] = value.split(".");
  if (!nonce || !ciphertext) throw new Error("Invalid session");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(nonce) }, await sessionKey(env), fromB64url(ciphertext)
  );
  const session = JSON.parse(new TextDecoder().decode(plaintext));
  if (!session.token || !session.expires || Date.now() >= session.expires) throw new Error("Expired session");
  return session;
}

async function github(path, token, options = {}) {
  const response = await fetch(path.startsWith("https://") ? path : `${REPO_API}${path}`, {
    ...options,
    headers: { ...GITHUB_HEADERS, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(JSON.stringify({ event: "github_gallery_error", status: response.status, path }));
    if (response.status === 401 || response.status === 403) throw new Error("Accesso GitHub scaduto o senza permesso di modifica.");
    if (response.status === 409 || response.status === 422) throw new Error("La galleria è cambiata nel frattempo. Aggiorna la pagina e riprova.");
    throw new Error("GitHub non ha accettato la pubblicazione. Riprova tra poco.");
  }
  return data;
}

async function readBody(request) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) throw new Error("L'immagine supera il limite di 10 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Richiesta vuota.");
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("L'immagine supera il limite di 10 MB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function authStart(env, request) {
  if (!env.GALLERY_CLIENT_ID || !env.GALLERY_CLIENT_SECRET || !env.GALLERY_SESSION_KEY) {
    return json({ error: "L'accesso alla gestione gallerie non è ancora configurato." }, 503);
  }
  const state = randomToken();
  const verifier = randomToken();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const callback = `${new URL(request.url).origin}/api/gallery/auth/callback`;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GALLERY_CLIENT_ID);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const response = Response.redirect(url.href, 302);
  const headers = new Headers(response.headers);
  headers.set("Set-Cookie", `gallery_oauth=${b64url(new TextEncoder().encode(JSON.stringify({ state, verifier })))}; Path=/api/gallery/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
  headers.set("Cache-Control", "no-store");
  return new Response(null, { status: 302, headers });
}

async function authCallback(env, request) {
  const url = new URL(request.url);
  const cookie = request.headers.get("Cookie")?.match(/(?:^|;\s*)gallery_oauth=([^;]+)/)?.[1];
  if (!cookie || !url.searchParams.get("code")) return json({ error: "Accesso GitHub interrotto. Torna ai Tools e riprova." }, 400);
  let saved;
  try { saved = JSON.parse(new TextDecoder().decode(fromB64url(cookie))); }
  catch { return json({ error: "Accesso GitHub scaduto. Riprova." }, 400); }
  if (!saved.state || saved.state !== url.searchParams.get("state")) return json({ error: "Verifica dell'accesso non riuscita. Riprova." }, 400);
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GALLERY_CLIENT_ID,
      client_secret: env.GALLERY_CLIENT_SECRET,
      code: url.searchParams.get("code"),
      code_verifier: saved.verifier,
      redirect_uri: `${url.origin}/api/gallery/auth/callback`
    })
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) return json({ error: "GitHub non ha autorizzato l'accesso. Riprova." }, 403);
  const user = await github("https://api.github.com/user", tokenData.access_token);
  await github("", tokenData.access_token);
  const expires = Date.now() + Math.min((tokenData.expires_in || 3600) * 1000, 60 * 60 * 1000);
  const session = await seal({ token: tokenData.access_token, login: user.login, expires }, env);
  const headers = new Headers({
    Location: `${TOOL_URL}#session=${encodeURIComponent(session)}`,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Set-Cookie": "gallery_oauth=; Path=/api/gallery/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
  });
  return new Response(null, { status: 302, headers });
}

async function readCatalog(token) {
  const file = await github("/contents/gallery/catalog.json?ref=main", token);
  const catalog = JSON.parse(decodeUtf8Base64(file.content));
  return { catalog, sha: file.sha };
}

function verifyOrder(catalog, category, order) {
  const existing = catalog.sections?.[category]?.map(item => item.id);
  return Array.isArray(order) && Array.isArray(existing) && order.length === existing.length
    && new Set(order).size === existing.length && order.every(id => existing.includes(id));
}

async function publishOrder(token, body) {
  const { category, order } = body;
  if (!CATEGORIES.has(category)) throw new Error("Sezione non valida.");
  const { catalog, sha } = await readCatalog(token);
  if (!verifyOrder(catalog, category, order)) throw new Error("La galleria è cambiata. Aggiorna la pagina e riprova.");
  const byId = new Map(catalog.sections[category].map(item => [item.id, item]));
  catalog.sections[category] = order.map(id => byId.get(id));
  await github("/contents/gallery/catalog.json", token, {
    method: "PUT",
    body: JSON.stringify({ message: `Riordina galleria ${category}`, content: utf8base64(JSON.stringify(catalog, null, 2) + "\n"), sha, branch: "main" })
  });
  return { status: "publishing" };
}

async function publishRemoval(token, body) {
  const { category, id } = body;
  if (!CATEGORIES.has(category) || typeof id !== "string") throw new Error("Foto non valida.");
  const { catalog, sha } = await readCatalog(token);
  const photos = catalog.sections?.[category];
  if (!Array.isArray(photos) || photos.filter(photo => photo.id === id).length !== 1) {
    throw new Error("La foto non è più presente. Aggiorna la pagina e riprova.");
  }
  if (!Array.isArray(catalog.removed || [])) {
    throw new Error("Catalogo non valido. Riprova più tardi.");
  }
  catalog.sections[category] = photos.filter(photo => photo.id !== id);
  catalog.removed = [...new Set([...(catalog.removed || []), id])];
  await github("/contents/gallery/catalog.json", token, {
    method: "PUT",
    body: JSON.stringify({ message: `Rimuovi foto dalla galleria ${category}`, content: utf8base64(JSON.stringify(catalog, null, 2) + "\n"), sha, branch: "main" })
  });
  return { status: "publishing", id };
}

async function publishImage(token, body) {
  const { mode, category, id, titles, extension, image } = body;
  if (!CATEGORIES.has(category) || !["add", "replace"].includes(mode)) throw new Error("Operazione non valida.");
  if (!titles || ["it", "en", "sl"].some(language => typeof titles[language] !== "string" || !titles[language].trim() || titles[language].length > 90)) {
    throw new Error("Scrivi i tre titoli, ciascuno entro 90 caratteri.");
  }
  if (!["jpg", "jpeg", "png", "webp"].includes(extension) || typeof image !== "string" || image.length % 4 !== 0 || image.length > 14_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    throw new Error("Scegli un'immagine JPG, PNG o WebP di massimo 10 MB.");
  }
  const imageBytes = Math.floor(image.length * 3 / 4) - (image.endsWith("==") ? 2 : image.endsWith("=") ? 1 : 0);
  if (imageBytes > 10 * 1024 * 1024) throw new Error("L'immagine supera il limite di 10 MB.");
  const { catalog } = await readCatalog(token);
  if (mode === "replace" && !catalog.sections[category].some(item => item.id === id)) throw new Error("La foto selezionata non è più presente. Aggiorna la pagina.");
  const uploadId = crypto.randomUUID().replace(/-/g, "");
  const request = JSON.stringify({ mode, category, id: mode === "replace" ? id : undefined, titles, extension });
  const branch = await github("/git/ref/heads/main", token);
  const head = branch.object.sha;
  const commit = await github(`/git/commits/${head}`, token);
  const imageBlob = await github("/git/blobs", token, { method: "POST", body: JSON.stringify({ content: image, encoding: "base64" }) });
  const requestBlob = await github("/git/blobs", token, { method: "POST", body: JSON.stringify({ content: request, encoding: "utf-8" }) });
  const tree = await github("/git/trees", token, {
    method: "POST",
    body: JSON.stringify({ base_tree: commit.tree.sha, tree: [
      { path: `gallery/inbox/${uploadId}.${extension}`, mode: "100644", type: "blob", sha: imageBlob.sha },
      { path: `gallery/inbox/${uploadId}.json`, mode: "100644", type: "blob", sha: requestBlob.sha }
    ] })
  });
  const next = await github("/git/commits", token, {
    method: "POST",
    body: JSON.stringify({ message: `Carica foto per galleria ${category}`, tree: tree.sha, parents: [head] })
  });
  await github("/git/refs/heads/main", token, { method: "PATCH", body: JSON.stringify({ sha: next.sha, force: false }) });
  return { status: "publishing", id: mode === "add" ? `photo-${uploadId}` : id };
}

export async function handleGalleryApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  if (path === "/api/gallery/auth/start" && request.method === "GET") return authStart(env, request);
  if (path === "/api/gallery/auth/callback" && request.method === "GET") return authCallback(env, request);
  if (request.headers.get("Origin") !== TOOL_ORIGIN) return json({ error: "Origine non consentita." }, 403);
  if (path === "/api/gallery/status" && request.method === "GET") {
    return cors(json({ configured: Boolean(env.GALLERY_CLIENT_ID && env.GALLERY_CLIENT_SECRET && env.GALLERY_SESSION_KEY) }));
  }
  if (path === "/api/gallery/catalog" && request.method === "GET") {
    const asset = await env.ASSETS.fetch(new Request(`${url.origin}/gallery/catalog.json`));
    return cors(asset);
  }
  if (path !== "/api/gallery/session" && path !== "/api/gallery/publish") return cors(json({ error: "Pagina non trovata." }, 404));
  try {
    const bearer = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!bearer) return cors(json({ error: "Accedi a GitHub per pubblicare." }, 401));
    const session = await unseal(bearer, env);
    if (path === "/api/gallery/session" && request.method === "GET") return cors(json({ login: session.login, expires: session.expires }));
    if (path !== "/api/gallery/publish" || request.method !== "POST") return cors(json({ error: "Operazione non disponibile." }, 405));
    const body = await readBody(request);
    const result = body.mode === "reorder" ? await publishOrder(session.token, body)
      : body.mode === "remove" ? await publishRemoval(session.token, body)
      : await publishImage(session.token, body);
    return cors(json(result, 202));
  } catch (error) {
    if (error instanceof SyntaxError) return cors(json({ error: "Dati non validi. Riprova." }, 400));
    if (error?.message === "Expired session" || error?.message === "Invalid session") return cors(json({ error: "Accesso scaduto. Accedi di nuovo a GitHub." }, 401));
    if (error?.name === "OperationError") return cors(json({ error: "Accesso scaduto. Accedi di nuovo a GitHub." }, 401));
    return cors(json({ error: error?.message || "Pubblicazione non riuscita." }, 400));
  }
}
