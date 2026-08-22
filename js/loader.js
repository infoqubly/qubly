(() => {
    const loader = document.getElementById("site-loader");
    const video = document.querySelector(".hero-video");

    if (!loader) {
        document.body.classList.remove("is-loading");
        return;
    }

    const progressLabel = loader.querySelector("[data-loader-progress]");
    const startedAt = performance.now();
    const minimumVisibleTime = 900;
    const maximumWaitTime = 15000;
    let displayedProgress = 0;
    let targetProgress = 0;
    let lastRoundedProgress = -1;
    let ready = false;
    let closed = false;

    function updateProgress(value) {
        displayedProgress = Math.max(0, Math.min(100, value));
        const roundedProgress = Math.round(displayedProgress);
        const remainder = 1 - (displayedProgress / 100);

        loader.style.setProperty("--loader-remainder", `${remainder}turn`);
        loader.dataset.progress = String(roundedProgress);

        if (roundedProgress === lastRoundedProgress) {
            return;
        }

        lastRoundedProgress = roundedProgress;
        progressLabel.textContent = `${roundedProgress}%`;
        loader.setAttribute("aria-label", `Caricamento ${roundedProgress}%`);
    }

    function setTarget(value) {
        targetProgress = Math.max(targetProgress, Math.min(100, value));
    }

    function readBufferedProgress() {
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0 || video.buffered.length === 0) {
            return;
        }

        const bufferedRatio = video.buffered.end(video.buffered.length - 1) / video.duration;
        setTarget(12 + (Math.min(1, bufferedRatio) * 78));
    }

    function closeLoader() {
        if (closed) {
            return;
        }

        closed = true;
        updateProgress(100);
        loader.classList.add("is-complete");
        loader.setAttribute("aria-hidden", "true");
        document.body.classList.remove("is-loading");

        window.setTimeout(() => loader.remove(), 650);
    }

    function markReady() {
        if (ready) {
            return;
        }

        ready = true;
        setTarget(100);
    }

    function animate(now) {
        if (closed) {
            return;
        }

        const elapsed = now - startedAt;
        if (!ready) {
            const smoothFallback = 8 + ((1 - Math.exp(-elapsed / 4300)) * 82);
            setTarget(Math.min(90, smoothFallback));
        }

        const easing = targetProgress >= 100 ? 0.16 : 0.055;
        let nextProgress = displayedProgress + ((targetProgress - displayedProgress) * easing);

        if (!ready) {
            nextProgress = Math.min(92, nextProgress);
        }

        updateProgress(nextProgress);

        if (ready && displayedProgress >= 99.5 && elapsed >= minimumVisibleTime) {
            closeLoader();
            return;
        }

        requestAnimationFrame(animate);
    }

    if (!video) {
        markReady();
    } else {
        video.addEventListener("loadedmetadata", () => setTarget(22), { once: true });
        video.addEventListener("loadeddata", () => setTarget(68), { once: true });
        video.addEventListener("progress", readBufferedProgress);
        video.addEventListener("canplay", markReady, { once: true });
        video.addEventListener("playing", markReady, { once: true });
        video.addEventListener("error", markReady, { once: true });

        if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
            markReady();
        }
    }

    window.setTimeout(markReady, maximumWaitTime);
    updateProgress(0);
    requestAnimationFrame(animate);
})();
