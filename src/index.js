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
    ["/spazi.html", "/spazi"],
    ["/spazi/", "/spazi"]
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

export default {
    async fetch(request, env) {
        const canonicalUrl = getCanonicalUrl(request);

        if (canonicalUrl) {
            return Response.redirect(canonicalUrl, 301);
        }

        return env.ASSETS.fetch(request);
    }
};
