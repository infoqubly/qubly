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
const MAX_WRITE_ATTEMPTS = 5;
const GITHUB_TIMEOUT_MS = 15_000;
const BODY_TIMEOUT_MS = 30_000;
const PUBLICATION_TIMEOUT_MS = 45_000;

class RequestTimeoutError extends Error {
  constructor() {
    super("La richiesta ha impiegato troppo tempo. Riprova tra poco.");
    this.code = "request_timeout";
    this.httpStatus = 504;
  }
}

class PublicationUnknownError extends Error {
  constructor() {
    super("Non è stato possibile confermare il salvataggio. La modifica potrebbe essere già in pubblicazione: controlla la galleria prima di inviarla di nuovo.");
    this.code = "publication_unknown";
    this.httpStatus = 503;
  }
}

async function withTimeout(operation, duration, onTimeout) {
  if (duration <= 0) throw new RequestTimeoutError();
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new RequestTimeoutError());
      controller.abort();
      onTimeout?.();
    }, duration);
  });
  try {
    // The race also bounds a stalled stream/provider that ignores cancellation.
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

class GitHubError extends Error {
  constructor(message, status, detail = "") {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function concurrentWrite(error) {
  // 422 also covers validation/abuse errors: retry only an explicit stale ref/SHA.
  return error instanceof GitHubError && (error.status === 409 || (error.status === 422
    && /not a fast[- ]forward|sha[^\n]*(?:does not match|mismatch)|is at [a-f0-9]+ but expected/i.test(error.detail)));
}

function uncertainWrite(error) {
  return error instanceof GitHubError && (error.status === 0 || error.status >= 500);
}

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

async function github(path, access, options = {}) {
  const token = typeof access === "string" ? access : access.token;
  const remaining = typeof access === "string" ? GITHUB_TIMEOUT_MS : access.deadline - Date.now();
  // Exhausting the operation budget before sending a request is a known timeout,
  // unlike losing the response to a write already sent to GitHub.
  if (remaining <= 0) throw new RequestTimeoutError();
  let response;
  try {
    return await withTimeout(async signal => {
      response = await fetch(path.startsWith("https://") ? path : `${REPO_API}${path}`, {
        cache: "no-store",
        ...options,
        signal,
        headers: { ...GITHUB_HEADERS, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers }
      });
      let data;
      try { data = await response.json(); }
      catch (error) {
        // A rejected HTTP status still proves a write was rejected. A truncated
        // successful response must be checked as an uncertain write instead.
        if (response.ok || signal.aborted) throw error;
        data = {};
      }
      if (!response.ok) {
        console.error(JSON.stringify({ event: "github_gallery_error", status: response.status, path }));
        const message = response.status === 401 || response.status === 403 ? "Accesso GitHub scaduto o senza permesso di modifica."
          : response.status === 409 || response.status === 422 ? "La galleria è cambiata nel frattempo. Aggiorna la pagina e riprova."
          : "GitHub non ha accettato la pubblicazione. Riprova tra poco.";
        throw new GitHubError(message, response.status, JSON.stringify(data));
      }
      return data;
    }, Math.min(GITHUB_TIMEOUT_MS, remaining));
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    const failure = new GitHubError("GitHub non ha confermato la richiesta. Riprova tra poco.", response && !response.ok ? response.status : 0);
    if (error instanceof RequestTimeoutError) {
      failure.code = "request_timeout";
      failure.httpStatus = 504;
    }
    throw failure;
  }
}

async function readBody(request) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) throw new Error("L'immagine supera il limite di 10 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Richiesta vuota.");
  const cancel = () => { void reader.cancel().catch(() => {}); };
  try {
    return await withTimeout(async () => {
      let size = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          cancel();
          throw new Error("L'immagine supera il limite di 10 MB.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder().decode(bytes));
    }, BODY_TIMEOUT_MS, cancel);
  } finally {
    reader.releaseLock();
  }
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
  let tokenResponse;
  let tokenData;
  try {
    await withTimeout(async signal => {
      tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        signal,
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.GALLERY_CLIENT_ID,
          client_secret: env.GALLERY_CLIENT_SECRET,
          code: url.searchParams.get("code"),
          code_verifier: saved.verifier,
          redirect_uri: `${url.origin}/api/gallery/auth/callback`
        })
      });
      tokenData = await tokenResponse.json();
    }, GITHUB_TIMEOUT_MS);
  } catch {
    return json({ error: "GitHub non ha confermato l'accesso. Torna ai Tools e accedi di nuovo." }, 503);
  }
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

async function readCatalog(token, ref = "main") {
  const file = await github(`/contents/gallery/catalog.json?ref=${encodeURIComponent(ref)}`, token);
  const catalog = JSON.parse(decodeUtf8Base64(file.content));
  return { catalog, sha: file.sha };
}

async function updateCatalog(token, message, change) {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const { catalog, sha } = await readCatalog(token);
    if (!change(catalog)) return;
    try {
      await github("/contents/gallery/catalog.json", token, {
        method: "PUT",
        body: JSON.stringify({ message, content: utf8base64(JSON.stringify(catalog, null, 2) + "\n"), sha, branch: "main" })
      });
      return;
    } catch (error) {
      if (uncertainWrite(error)) {
        try {
          const latest = await readCatalog(token);
          if (!change(latest.catalog)) return;
        } catch { /* The saved state could not be confirmed within the budget. */ }
        throw new PublicationUnknownError();
      }
      if (!concurrentWrite(error) || attempt === MAX_WRITE_ATTEMPTS - 1) throw error;
    }
  }
}

function verifyOrder(catalog, category, order) {
  const existing = catalog.sections?.[category]?.map(item => item.id);
  return Array.isArray(order) && Array.isArray(existing) && order.length === existing.length
    && new Set(order).size === existing.length && order.every(id => existing.includes(id));
}

async function publishOrder(token, body) {
  const { category, order } = body;
  if (!CATEGORIES.has(category)) throw new Error("Sezione non valida.");
  await updateCatalog(token, `Riordina galleria ${category}`, catalog => {
    if (!verifyOrder(catalog, category, order)) throw new Error("Le foto della galleria sono cambiate. Aggiorna la pagina per scegliere il nuovo ordine.");
    if (catalog.sections[category].every((item, index) => item.id === order[index])) return false;
    const byId = new Map(catalog.sections[category].map(item => [item.id, item]));
    catalog.sections[category] = order.map(id => byId.get(id));
    return true;
  });
  return { status: "publishing" };
}

async function publishRemoval(token, body) {
  const { category, id } = body;
  if (!CATEGORIES.has(category) || typeof id !== "string") throw new Error("Foto non valida.");
  await updateCatalog(token, `Rimuovi foto dalla galleria ${category}`, catalog => {
    const photos = catalog.sections?.[category];
    if (!Array.isArray(catalog.removed || [])) throw new Error("Catalogo non valido. Riprova più tardi.");
    const matches = Array.isArray(photos) ? photos.filter(photo => photo.id === id).length : -1;
    if (matches === 0 && catalog.removed?.includes(id)) return false;
    if (matches !== 1) throw new Error("La foto non è più presente. Aggiorna la pagina e riprova.");
    catalog.sections[category] = photos.filter(photo => photo.id !== id);
    catalog.removed = [...new Set([...(catalog.removed || []), id])];
    return true;
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
  const uploadId = crypto.randomUUID().replace(/-/g, "");
  const request = JSON.stringify({ mode, category, id: mode === "replace" ? id : undefined, titles, extension });
  const result = { status: "publishing", id: mode === "add" ? `photo-${uploadId}` : id };
  let entries;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const branch = await github("/git/ref/heads/main", token);
    const head = branch.object.sha;
    const { catalog } = await readCatalog(token, head);
    if (mode === "replace" && !catalog.sections?.[category]?.some(item => item.id === id)) throw new Error("La foto selezionata non è più presente. Aggiorna la pagina.");
    const commit = await github(`/git/commits/${head}`, token);
    if (!entries) {
      const imageBlob = await github("/git/blobs", token, { method: "POST", body: JSON.stringify({ content: image, encoding: "base64" }) });
      const requestBlob = await github("/git/blobs", token, { method: "POST", body: JSON.stringify({ content: request, encoding: "utf-8" }) });
      entries = [
        { path: `gallery/inbox/${uploadId}.${extension}`, mode: "100644", type: "blob", sha: imageBlob.sha },
        { path: `gallery/inbox/${uploadId}.json`, mode: "100644", type: "blob", sha: requestBlob.sha }
      ];
    }
    const tree = await github("/git/trees", token, {
      method: "POST", body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries })
    });
    const next = await github("/git/commits", token, {
      method: "POST",
      body: JSON.stringify({ message: `Carica foto per galleria ${category}`, tree: tree.sha, parents: [head] })
    });
    try {
      await github("/git/refs/heads/main", token, { method: "PATCH", body: JSON.stringify({ sha: next.sha, force: false }) });
      return result;
    } catch (error) {
      // A lost response may hide an accepted PATCH. Check history, even if the
      // publisher has already consumed/deleted the inbox files in a newer commit.
      if (uncertainWrite(error)) {
        try {
          const latest = await github("/git/ref/heads/main", token);
          if (latest.object.sha === next.sha) return result;
          const comparison = await github(`/compare/${next.sha}...${latest.object.sha}`, token);
          if (["ahead", "identical"].includes(comparison.status)) return result;
        } catch { /* Do not replay a write whose outcome could not be checked. */ }
        throw new PublicationUnknownError();
      }
      if (!concurrentWrite(error) || attempt === MAX_WRITE_ATTEMPTS - 1) throw error;
    }
  }
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
    const access = { token: session.token, deadline: Date.now() + PUBLICATION_TIMEOUT_MS };
    const result = body.mode === "reorder" ? await publishOrder(access, body)
      : body.mode === "remove" ? await publishRemoval(access, body)
      : await publishImage(access, body);
    return cors(json(result, 202));
  } catch (error) {
    if (error instanceof SyntaxError) return cors(json({ error: "Dati non validi. Riprova." }, 400));
    if (error?.message === "Expired session" || error?.message === "Invalid session") return cors(json({ error: "Accesso scaduto. Accedi di nuovo a GitHub." }, 401));
    if (error?.name === "OperationError") return cors(json({ error: "Accesso scaduto. Accedi di nuovo a GitHub." }, 401));
    return cors(json({ error: error?.message || "Pubblicazione non riuscita.", ...(error?.code ? { code: error.code } : {}) }, error?.httpStatus || 400));
  }
}
