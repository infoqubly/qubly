const CANONICAL_PATHS = new Map([
    ["/index.html", "/"],
    ["/about.html", "/about"],
    ["/about/", "/about"],
    ["/esterni.html", "/esterni"],
    ["/esterni/", "/esterni"],
    ["/interni.html", "/interni"],
    ["/interni/", "/interni"],
    ["/paesaggi.html", "/paesaggi"],
    ["/paesaggi/", "/paesaggi"],
    ["/privacy-policy.html", "/privacy-policy"],
    ["/privacy-policy/", "/privacy-policy"],
    ["/spazi", "/paesaggi"],
    ["/spazi.html", "/paesaggi"],
    ["/spazi/", "/paesaggi"]
]);

const DOCUMENT_PATHS = new Set([
    "/",
    "/about",
    "/esterni",
    "/interni",
    "/paesaggi",
    "/privacy-policy"
]);

function getCanonicalUrl(request) {
    const url = new URL(request.url);
    let changed = false;

    if (url.protocol !== "https:") {
        url.protocol = "https:";
        changed = true;
    }

    const canonicalPath = CANONICAL_PATHS.get(url.pathname);
    if (canonicalPath) {
        url.pathname = canonicalPath;
        changed = true;
    }

    return changed ? url.toString() : null;
}

function addDocumentHeaders(response) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

export default {
    async fetch(request, env) {
        const canonicalUrl = getCanonicalUrl(request);

        if (canonicalUrl) {
            return Response.redirect(canonicalUrl, 301);
        }

        const response = await env.ASSETS.fetch(request);
        const pathname = new URL(request.url).pathname;

        return DOCUMENT_PATHS.has(pathname) ? addDocumentHeaders(response) : response;
    }
};
