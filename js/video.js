document.addEventListener("DOMContentLoaded", () => {
    const video = document.querySelector(".hero-video");
    const button = document.querySelector(".hero-video-toggle");
    if (!video || !button) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = navigator.connection;
    let inView = true;
    let manuallyPaused = false;
    let manualPlay = false;
    let attached = false;
    const dict = typeof translations !== "undefined" ? (translations[document.documentElement.lang] || translations.en) : {};
    const autoAllowed = () => !reduced.matches && !connection?.saveData && !/^(slow-2g|2g)$/.test(connection?.effectiveType || "");
    function updateLabel() {
        const paused = video.paused;
        button.dataset.state = paused ? "paused" : "playing";
        button.setAttribute("aria-label", dict[paused ? "play_video" : "pause_video"] || (paused ? "Play video" : "Pause video"));
    }
    function attachSource() {
        if (attached) return;
        attached = true;
        // Select only one file, even in browsers that ignore media on source elements.
        const source = [...video.querySelectorAll("source")].find(source => matchMedia(source.media).matches);
        if (!source) return;
        video.src = source.dataset.src;
        video.load();
    }
    function syncPlayback() {
        const shouldPlay = inView && !document.hidden && !manuallyPaused && (manualPlay || autoAllowed());
        if (!shouldPlay) {video.pause(); updateLabel(); return;}
        attachSource();
        video.play().catch(() => updateLabel());
    }
    button.hidden = false;
    button.addEventListener("click", () => {
        if (video.paused) {manuallyPaused = false; manualPlay = true;}
        else {manuallyPaused = true; manualPlay = false;}
        syncPlayback();
    });
    video.addEventListener("playing", () => {
        video.classList.add("is-playing");
        updateLabel();
    });
    video.addEventListener("pause", updateLabel);
    video.addEventListener("error", () => {
        video.classList.remove("is-playing"); updateLabel();
    });
    document.addEventListener("visibilitychange", syncPlayback);
    reduced.addEventListener("change", () => {manualPlay = false; syncPlayback();});
    connection?.addEventListener("change", syncPlayback);
    if ("IntersectionObserver" in window) {
        new IntersectionObserver(([entry]) => {inView = entry.isIntersecting; syncPlayback();}, {threshold:0.05}).observe(video);
    } else syncPlayback();
    updateLabel();
});
