(() => {
    const loader = document.getElementById("site-loader");
    if (!loader) return;
    const label = loader.querySelector("[data-loader-progress]");
    const video = document.querySelector(".hero-video");
    const poster = document.querySelector(".hero-poster");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let closed = false;
    let ready = reduced;
    let frame = 0;
    let seen = false;
    try { seen = sessionStorage.getItem("qubly-intro-seen") === "1"; } catch {}
    function close() {
        if (closed) return;
        closed = true;
        cancelAnimationFrame(frame);
        clearTimeout(deadline);
        loader.style.setProperty("--loader-remainder", "0turn");
        if (label) label.textContent = "100%";
        loader.classList.add("is-complete");
        loader.setAttribute("aria-hidden", "true");
        document.body.classList.remove("is-loading");
        try { sessionStorage.setItem("qubly-intro-seen", "1"); } catch {}
        setTimeout(() => loader.remove(), reduced ? 0 : 220);
    }
    const deadline = setTimeout(close, 1800);
    function animate(now) {
        if (closed) return;
        const elapsed = now - started;
        const progress = Math.min(95, 12 + elapsed / 18);
        loader.style.setProperty("--loader-remainder", `${1-progress/100}turn`);
        if (label) label.textContent = `${Math.round(progress)}%`;
        if (ready && elapsed >= 250) return close();
        frame = requestAnimationFrame(animate);
    }
    const markReady = () => { ready = true; };
    video?.addEventListener("loadeddata", markReady, {once:true});
    video?.addEventListener("error", markReady, {once:true});
    if (poster?.complete || video?.readyState >= 2) ready = true;
    poster?.addEventListener("load", markReady, {once:true});
    poster?.addEventListener("error", markReady, {once:true});
    addEventListener("pageshow", event => { if (event.persisted) close(); });
    if (seen || reduced || location.hash) close();
    else frame = requestAnimationFrame(animate);
})();
