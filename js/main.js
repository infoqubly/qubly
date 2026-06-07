document.addEventListener("DOMContentLoaded", () => {
    const docEl = document.documentElement;
    const body = document.body;
    const menuToggle = document.querySelector(".menu-toggle");
    const fullscreenMenu = document.querySelector(".fullscreen-menu");
    const menuLinks = Array.from(document.querySelectorAll(".menu-item a"));
    const scrollTrigger = document.querySelector(".scroll-trigger-zone");
    const logo = document.querySelector(".logo");
    const contactTriggers = document.querySelectorAll(".contact-trigger-link");
    const revealItems = Array.from(document.querySelectorAll(".reveal"));
    const visualFlow = document.getElementById("visual-flow");
    const scrollShowcaseCards = Array.from(document.querySelectorAll(".scroll-showcase-card"));
    const isHomePage = body.classList.contains("home-page");
    const isSnapPage = isHomePage || body.classList.contains("about-page-body");
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const revealTimers = new WeakMap();

    function updateScrollbarWidth() {
        const scrollbarWidth = Math.max(0, window.innerWidth - docEl.clientWidth);
        docEl.style.setProperty("--scrollbar-width", `${scrollbarWidth}px`);
    }

    updateScrollbarWidth();
    window.addEventListener("resize", updateScrollbarWidth);

    function isDesktopSnapEnabled() {
        return isSnapPage
            && !prefersReducedMotion.matches
            && window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches;
    }

    function closeMenu() {
        if (!menuToggle || !fullscreenMenu) {
            return;
        }

        body.classList.remove("menu-open-body");
        menuToggle.classList.remove("menu-open");
        fullscreenMenu.classList.remove("active");
        document.removeEventListener("keydown", handleEscKey);
    }

    function toggleMenu() {
        if (!menuToggle || !fullscreenMenu) {
            return;
        }

        body.classList.toggle("menu-open-body");
        menuToggle.classList.toggle("menu-open");
        fullscreenMenu.classList.toggle("active");

        if (fullscreenMenu.classList.contains("active")) {
            document.addEventListener("keydown", handleEscKey);
        } else {
            document.removeEventListener("keydown", handleEscKey);
        }
    }

    function handleEscKey(event) {
        if (event.key === "Escape") {
            closeMenu();
        }
    }

    function clearRevealTimer(element) {
        const timerId = revealTimers.get(element);
        if (timerId) {
            window.clearTimeout(timerId);
            revealTimers.delete(element);
        }
    }

    function showRevealImmediately(element) {
        clearRevealTimer(element);
        element.classList.add("is-visible");
    }

    function hideReveal(element) {
        clearRevealTimer(element);
        element.classList.remove("is-visible");
    }

    function flushDelayedReveals(scope) {
        if (!scope) {
            return false;
        }

        const delayedReveals = Array.from(scope.querySelectorAll(".reveal"))
            .filter((element) => Number.parseInt(element.getAttribute("data-delay") || "0", 10) > 0)
            .filter((element) => !element.classList.contains("is-visible"));

        delayedReveals.forEach((element) => showRevealImmediately(element));
        return delayedReveals.length > 0;
    }

    if (menuToggle) {
        menuToggle.addEventListener("click", toggleMenu);
    }

    document.querySelectorAll(".case-snapshots .case-card[href='#']").forEach((card) => {
        card.addEventListener("click", (event) => {
            event.preventDefault();
        });
    });

    if (logo) {
        logo.addEventListener("click", (event) => {
            const isHomeLocation = window.location.pathname.endsWith("index.html")
                || window.location.pathname.endsWith("/");

            if (!isHomeLocation) {
                return;
            }

            event.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
            closeMenu();
        });
    }

    function initMobileShowcaseZoom() {
        if (!visualFlow || scrollShowcaseCards.length === 0) {
            return;
        }

        const mobileQuery = window.matchMedia("(max-width: 767px)");
        let overlay = null;
        let track = null;
        let slides = [];
        let activeIndex = 0;
        let scrollTimer = 0;

        function escapeHtml(value) {
            return value
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#039;");
        }

        function ensureOverlay() {
            if (overlay) {
                return;
            }

            overlay = document.createElement("div");
            overlay.className = "mobile-showcase-zoom";
            overlay.setAttribute("aria-hidden", "true");

            const slideMarkup = scrollShowcaseCards.map((card, index) => {
                const image = card.querySelector("img");
                const src = image?.currentSrc || image?.src || image?.getAttribute("src") || "";
                const alt = image?.getAttribute("alt") || "";
                const tagMarkup = Array.from(card.querySelectorAll(".showcase-tags span"))
                    .map((tag) => tag.textContent.trim())
                    .filter(Boolean)
                    .map((text) => `<span>${escapeHtml(text)}</span>`)
                    .join("");
                return `
                    <div class="mobile-showcase-zoom-slide" data-index="${index}">
                        <div class="mobile-showcase-zoom-frame">
                            <img src="${src}" alt="${escapeHtml(alt)}" loading="eager" decoding="sync" draggable="false">
                        </div>
                        <div class="mobile-showcase-zoom-tags">${tagMarkup}</div>
                    </div>
                `;
            }).join("");

            overlay.innerHTML = `
                <button class="mobile-showcase-zoom-close" type="button" aria-label="Close image preview"></button>
                <div class="mobile-showcase-zoom-track">${slideMarkup}</div>
            `;

            body.appendChild(overlay);
            track = overlay.querySelector(".mobile-showcase-zoom-track");
            slides = Array.from(overlay.querySelectorAll(".mobile-showcase-zoom-slide"));

            slides.forEach((slide) => {
                const zoomImage = slide.querySelector("img");
                if (!zoomImage) {
                    return;
                }

                const markLoaded = () => zoomImage.classList.add("is-loaded");
                if (zoomImage.complete && zoomImage.naturalWidth > 0) {
                    markLoaded();
                } else {
                    zoomImage.addEventListener("load", markLoaded, { once: true });
                    zoomImage.decode?.().then(markLoaded).catch(() => {
                        if (zoomImage.complete) {
                            markLoaded();
                        }
                    });
                }
            });

            overlay.querySelector(".mobile-showcase-zoom-close")?.addEventListener("click", closeZoom);
            overlay.addEventListener("click", (event) => {
                if (event.target === overlay) {
                    closeZoom();
                }
            });

            track?.addEventListener("scroll", () => {
                window.clearTimeout(scrollTimer);
                scrollTimer = window.setTimeout(() => {
                    const nextIndex = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
                    setActiveSlide(nextIndex);
                }, 80);
            }, { passive: true });
        }

        function setActiveSlide(index) {
            activeIndex = Math.max(0, Math.min(slides.length - 1, index));
            slides.forEach((slide, slideIndex) => {
                slide.classList.toggle("is-active", slideIndex === activeIndex);
            });
        }

        function animateZoomFrom(sourceRect, sourceRadius) {
            if (!overlay || prefersReducedMotion.matches) {
                return;
            }

            const frame = slides[activeIndex]?.querySelector(".mobile-showcase-zoom-frame");
            if (!frame?.animate) {
                return;
            }

            const finalRect = frame.getBoundingClientRect();
            if (!finalRect.width || !finalRect.height) {
                return;
            }

            const scaleX = sourceRect.width / finalRect.width;
            const scaleY = sourceRect.height / finalRect.height;
            const translateX = sourceRect.left + (sourceRect.width / 2) - (finalRect.left + (finalRect.width / 2));
            const translateY = sourceRect.top + (sourceRect.height / 2) - (finalRect.top + (finalRect.height / 2));

            frame.animate([
                {
                    transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
                    borderRadius: sourceRadius,
                    opacity: 0.72
                },
                {
                    transform: "translate(0, 0) scale(1, 1)",
                    borderRadius: getComputedStyle(frame).borderRadius,
                    opacity: 1
                }
            ], {
                duration: 560,
                easing: "cubic-bezier(0.22, 1, 0.36, 1)"
            });
        }

        function openZoom(index, card) {
            if (!mobileQuery.matches) {
                return;
            }

            ensureOverlay();
            if (!overlay || !track) {
                return;
            }

            const sourceRect = card.getBoundingClientRect();
            const sourceRadius = getComputedStyle(card).borderRadius;
            setActiveSlide(index);
            overlay.classList.add("is-open");
            overlay.setAttribute("aria-hidden", "false");
            body.classList.add("mobile-showcase-zoom-open");
            closeMenu();

            window.requestAnimationFrame(() => {
                track.scrollLeft = track.clientWidth * activeIndex;
                window.requestAnimationFrame(() => animateZoomFrom(sourceRect, sourceRadius));
            });
        }

        function closeZoom() {
            if (!overlay) {
                return;
            }

            overlay.classList.remove("is-open");
            overlay.setAttribute("aria-hidden", "true");
            body.classList.remove("mobile-showcase-zoom-open");
        }

        scrollShowcaseCards.forEach((card, index) => {
            const image = card.querySelector("img");
            image?.addEventListener("click", (event) => {
                if (!mobileQuery.matches) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                openZoom(index, card);
            });
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeZoom();
            }
        });

        mobileQuery.addEventListener?.("change", () => {
            if (!mobileQuery.matches) {
                closeZoom();
            }
        });
    }

    function getScrollDestination(target) {
        if (!target) {
            return 0;
        }

        const mobileOffsetlessTargets = new Set(["projects", "contact"]);
        const useMobileOffsetlessSnap = window.matchMedia("(max-width: 767px)").matches
            && mobileOffsetlessTargets.has(target.id);
        const offsetRatio = useMobileOffsetlessSnap
            ? 0
            : Number.parseFloat(target.dataset.snapOffset || "0");
        const targetTop = target.getBoundingClientRect().top + window.scrollY;

        if (target.classList.contains("case-group") && window.matchMedia("(min-width: 1024px)").matches) {
            const centeredOffset = Math.max(0, (window.innerHeight - target.offsetHeight) / 2);
            return Math.max(0, Math.round(targetTop - centeredOffset));
        }

        return Math.max(0, Math.round(targetTop - (window.innerHeight * offsetRatio)));
    }

    function scrollToTarget(target) {
        if (!target) {
            return;
        }

        window.scrollTo({
            top: getScrollDestination(target),
            behavior: "smooth"
        });
    }

    function resolveViewportOffsetFromCssVar(element, cssVarName) {
        if (!element) {
            return 0;
        }

        const rawValue = window.getComputedStyle(element).getPropertyValue(cssVarName).trim();
        if (!rawValue) {
            return 0;
        }

        if (rawValue.endsWith("vh")) {
            return (window.innerHeight * Number.parseFloat(rawValue || "0")) / 100;
        }

        return Number.parseFloat(rawValue || "0") || 0;
    }

    function getVisualFlowScrollMetrics() {
        if (!visualFlow) {
            return null;
        }

        const showcaseStack = visualFlow.querySelector(".scroll-showcase-stack");
        const showcaseStage = visualFlow.querySelector(".scroll-showcase-stage");
        if (!showcaseStack || !showcaseStage) {
            return null;
        }

        const stackTop = showcaseStack.getBoundingClientRect().top + window.scrollY;
        const stageHeight = showcaseStage.offsetHeight;
        const stageTopPx = resolveViewportOffsetFromCssVar(visualFlow, "--showcase-stage-top");
        const availableScroll = Math.max(1, showcaseStack.offsetHeight - stageHeight);
        const pinStart = stackTop - stageTopPx;
        const pinEnd = pinStart + availableScroll;

        return {
            availableScroll,
            pinEnd,
            pinStart,
            stackTop,
            stageHeight,
            stageTopPx
        };
    }

    function getVisualFlowSnapMetrics() {
        if (!visualFlow) {
            return null;
        }

        const flowMetrics = getVisualFlowScrollMetrics();
        const defaultTop = getScrollDestination(visualFlow);
        const entryTop = flowMetrics
            ? Math.max(0, Math.round(flowMetrics.pinStart))
            : defaultTop;
        const exitTop = flowMetrics
            ? Math.max(entryTop + 1, Math.round(flowMetrics.pinEnd))
            : defaultTop;

        return {
            entryTop,
            exitTop,
            flowMetrics
        };
    }

    function initScrollShowcase() {
        if (scrollShowcaseCards.length === 0 || !visualFlow) {
            return;
        }

        const desktopMotionQuery = window.matchMedia("(min-width: 768px)");
        const mobileQuery = window.matchMedia("(max-width: 767px)");
        const showcaseStack = visualFlow.querySelector(".scroll-showcase-stack");
        const showcaseStage = visualFlow.querySelector(".scroll-showcase-stage");
        let showcaseTicking = false;

        if (!showcaseStack || !showcaseStage) {
            return;
        }

        visualFlow.classList.add("is-enhanced");

        scrollShowcaseCards.forEach((card, index) => {
            card.style.zIndex = `${index + 1}`;
        });

        function resetShowcaseStyles() {
            showcaseStage.style.position = "";
            showcaseStage.style.top = "";
            showcaseStage.style.left = "";
            showcaseStage.style.right = "";
            showcaseStage.style.width = "";

            scrollShowcaseCards.forEach((card, index) => {
                card.style.transform = "";
                card.style.opacity = "1";
                card.classList.toggle("is-active", index === 0);

                const image = card.querySelector("img");
                if (image) {
                    image.style.transform = "";
                }
            });
        }

        function clamp(value, min, max) {
            return Math.min(Math.max(value, min), max);
        }

        function updateShowcase() {
            showcaseTicking = false;

            if (mobileQuery.matches) {
                resetShowcaseStyles();
                return;
            }

            const stageHeight = showcaseStage.offsetHeight;
            const stackRect = showcaseStack.getBoundingClientRect();
            const stackTop = stackRect.top + window.scrollY;
            const availableScroll = Math.max(1, showcaseStack.offsetHeight - stageHeight);
            const stageTopPx = resolveViewportOffsetFromCssVar(visualFlow, "--showcase-stage-top");
            const pinStart = stackTop - stageTopPx;
            const pinEnd = pinStart + availableScroll;
            const currentScroll = clamp(window.scrollY - pinStart, 0, availableScroll);
            const segment = availableScroll / Math.max(1, scrollShowcaseCards.length - 1);
            const progress = segment > 0 ? currentScroll / segment : 0;
            const activeIndex = clamp(Math.floor(progress + 0.55), 0, scrollShowcaseCards.length - 1);
            const reduceMotion = prefersReducedMotion.matches;

            if (window.scrollY <= pinStart) {
                showcaseStage.style.position = "absolute";
                showcaseStage.style.top = "0px";
                showcaseStage.style.left = "0";
                showcaseStage.style.right = "0";
                showcaseStage.style.width = "";
            } else if (window.scrollY >= pinEnd) {
                showcaseStage.style.position = "absolute";
                showcaseStage.style.top = `${availableScroll}px`;
                showcaseStage.style.left = "0";
                showcaseStage.style.right = "0";
                showcaseStage.style.width = "";
            } else {
                showcaseStage.style.position = "fixed";
                showcaseStage.style.top = `${stageTopPx}px`;
                showcaseStage.style.left = `${stackRect.left}px`;
                showcaseStage.style.right = "";
                showcaseStage.style.width = `${stackRect.width}px`;
            }

            scrollShowcaseCards.forEach((card, index) => {
                const image = card.querySelector("img");
                const startOffset = index === 0 ? 0 : Math.min(116, 104 + ((index - 1) * 2));
                const localProgress = index === 0 ? 1 : clamp(progress - (index - 1), 0, 1);
                const easedProgress = reduceMotion
                    ? localProgress
                    : 1 - Math.pow(1 - localProgress, 3);
                const translatePercent = index === 0 ? 0 : startOffset * (1 - easedProgress);
                const speed = Number.parseFloat(image?.dataset.speed || "0.92");
                const imageShift = reduceMotion
                    ? 0
                    : (index === 0
                        ? -currentScroll * 0.012
                        : -((translatePercent / 100) * stageHeight) * (1 - speed + 0.14));

                card.classList.toggle("is-active", index === activeIndex);
                card.style.transform = `translate3d(0, ${translatePercent.toFixed(3)}%, 0)`;
                card.style.opacity = index === 0 || localProgress > 0 ? "1" : "0";

                if (image) {
                    image.style.transform = `translate3d(0, ${imageShift.toFixed(2)}px, 0) scale(1.035)`;
                }
            });
        }

        function scheduleShowcaseUpdate() {
            if (showcaseTicking) {
                return;
            }

            showcaseTicking = true;
            window.requestAnimationFrame(updateShowcase);
        }

        window.addEventListener("scroll", scheduleShowcaseUpdate, { passive: true });
        window.addEventListener("resize", scheduleShowcaseUpdate, { passive: true });
        window.addEventListener("load", scheduleShowcaseUpdate);
        prefersReducedMotion.addEventListener?.("change", scheduleShowcaseUpdate);
        desktopMotionQuery.addEventListener?.("change", scheduleShowcaseUpdate);
        scheduleShowcaseUpdate();
    }

    menuLinks.forEach((link) => {
        link.addEventListener("click", (event) => {
            closeMenu();

            const href = link.getAttribute("href") || "";
            if (!isHomePage || !href.startsWith("#")) {
                return;
            }

            const target = document.querySelector(href);
            if (!target) {
                return;
            }

            event.preventDefault();
            scrollToTarget(target);
        });
    });

    contactTriggers.forEach((trigger) => {
        trigger.addEventListener("click", async (event) => {
            if (trigger.getAttribute("href") && trigger.getAttribute("href") !== "#") {
                return;
            }

            event.preventDefault();
            const email = "info.qubly@gmail.com";

            try {
                await navigator.clipboard.writeText(email);
                const originalText = trigger.innerText;
                trigger.innerText = "Email copied!";
                window.setTimeout(() => {
                    trigger.innerText = originalText;
                }, 2000);
            } catch (error) {
                console.error("Failed to copy email:", error);
            }
        });
    });

    if (scrollTrigger) {
        scrollTrigger.addEventListener("click", () => {
            scrollToTarget(document.getElementById("intro"));
        });
    }

    const caseGroups = Array.from(document.querySelectorAll(".case-snapshots .case-group"));
    let activeCaseGroupIndex = -1;
    let caseTitleTicking = false;

    function restartCaseTitleFill(group) {
        const title = group.querySelector(".case-row-title");
        if (!title) {
            return;
        }

        group.classList.remove("is-title-filling");
        title.style.animation = "none";
        title.offsetHeight;
        title.style.animation = "";
        group.classList.add("is-title-filling");
    }

    function updateActiveCaseTitle() {
        caseTitleTicking = false;

        if (caseGroups.length === 0) {
            return;
        }

        const viewportTarget = window.innerHeight * 0.46;
        let nextIndex = -1;
        let nearestDistance = Number.POSITIVE_INFINITY;

        caseGroups.forEach((group, index) => {
            const rect = group.getBoundingClientRect();
            const isNearViewport = rect.top < window.innerHeight * 0.95 && rect.bottom > window.innerHeight * 0.05;
            if (!isNearViewport) {
                return;
            }

            const title = group.querySelector(".case-row-title");
            const titleRect = title ? title.getBoundingClientRect() : rect;
            const distance = Math.abs(titleRect.top - viewportTarget);

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nextIndex = index;
            }
        });

        if (nextIndex === -1 || nextIndex === activeCaseGroupIndex) {
            return;
        }

        caseGroups.forEach((group) => group.classList.remove("is-title-filling"));
        activeCaseGroupIndex = nextIndex;
        restartCaseTitleFill(caseGroups[nextIndex]);
    }

    function scheduleCaseTitleActivation() {
        if (caseTitleTicking || caseGroups.length === 0) {
            return;
        }

        caseTitleTicking = true;
        window.requestAnimationFrame(updateActiveCaseTitle);
    }

    window.addEventListener("scroll", scheduleCaseTitleActivation, { passive: true });
    window.addEventListener("resize", scheduleCaseTitleActivation, { passive: true });
    window.addEventListener("load", scheduleCaseTitleActivation);
    if (caseGroups.length > 0) {
        window.setInterval(updateActiveCaseTitle, 180);
    }
    if ("IntersectionObserver" in window && caseGroups.length > 0) {
        const caseTitleObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }

                const index = caseGroups.indexOf(entry.target);
                if (index === -1 || index === activeCaseGroupIndex) {
                    return;
                }

                caseGroups.forEach((group) => group.classList.remove("is-title-filling"));
                activeCaseGroupIndex = index;
                restartCaseTitleFill(entry.target);
            });
        }, {
            root: null,
            threshold: 0.18,
            rootMargin: "-12% 0px -28% 0px"
        });

        caseGroups.forEach((group) => caseTitleObserver.observe(group));
    }
    updateActiveCaseTitle();

    function initMobilePageSnap() {
        if (!isHomePage) {
            return;
        }

        const mobileQuery = window.matchMedia("(max-width: 767px)");
        const horizontalScrollSelector = ".scroll-showcase-stage, .mobile-showcase-zoom-track";
        const snapInputThreshold = 34;
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartScrollY = 0;
        let touchStartTarget = null;
        let gestureAxis = null;
        let snapLockUntil = 0;
        let nearestSnapTimer = 0;

        function isMobileSnapEnabled() {
            return mobileQuery.matches
                && !prefersReducedMotion.matches
                && !body.classList.contains("menu-open-body")
                && !body.classList.contains("mobile-showcase-zoom-open");
        }

        function getViewportHeight() {
            return window.visualViewport?.height || window.innerHeight;
        }

        function getMaxPageScrollTop() {
            return Math.max(0, docEl.scrollHeight - getViewportHeight());
        }

        function clampScrollTop(value) {
            return Math.max(0, Math.min(Math.round(value), getMaxPageScrollTop()));
        }

        function getElementPageTop(element) {
            return element.getBoundingClientRect().top + window.scrollY;
        }

        function getMobileTargetTop(element, mode = "start") {
            const elementTop = getElementPageTop(element);

            if (mode === "center") {
                const elementHeight = element.getBoundingClientRect().height;
                const centeredOffset = Math.max(0, (getViewportHeight() - elementHeight) / 2);
                return clampScrollTop(elementTop - centeredOffset);
            }

            return clampScrollTop(elementTop);
        }

        function getMobileSnapPoints() {
            const points = [{ element: null, key: "top", top: 0 }];
            const caseIntro = document.getElementById("case-studies");
            const intro = document.getElementById("intro");
            const projects = document.getElementById("projects");
            const contact = document.getElementById("contact");

            [
                [intro, "intro", "start"],
                [visualFlow, "visual-flow", "start"],
                [caseIntro, "case-title", "start"]
            ].forEach(([element, key, mode]) => {
                if (element) {
                    points.push({ element, key, top: getMobileTargetTop(element, mode) });
                }
            });

            caseGroups.forEach((group, index) => {
                points.push({
                    element: group,
                    key: `case-${index + 1}`,
                    top: getMobileTargetTop(group, "center")
                });
            });

            [
                [projects, "projects", "start"],
                [contact, "contact", "start"]
            ].forEach(([element, key, mode]) => {
                if (element) {
                    points.push({ element, key, top: getMobileTargetTop(element, mode) });
                }
            });

            return points
                .sort((left, right) => left.top - right.top)
                .filter((point, index, sortedPoints) => index === 0 || Math.abs(point.top - sortedPoints[index - 1].top) > 8);
        }

        function getNearestMobileSnapIndex(points, scrollTop = window.scrollY) {
            let nearestIndex = 0;
            let nearestDistance = Number.POSITIVE_INFINITY;

            points.forEach((point, index) => {
                const distance = Math.abs(point.top - scrollTop);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            });

            return nearestIndex;
        }

        function snapToMobileIndex(index, behavior = "smooth") {
            if (!isMobileSnapEnabled()) {
                return false;
            }

            const points = getMobileSnapPoints();
            if (points.length === 0) {
                return false;
            }

            const safeIndex = Math.max(0, Math.min(points.length - 1, index));
            snapLockUntil = performance.now() + 560;
            window.scrollTo({
                top: points[safeIndex].top,
                behavior
            });
            return true;
        }

        function snapByMobileDirection(direction) {
            if (!isMobileSnapEnabled() || direction === 0) {
                return false;
            }

            const points = getMobileSnapPoints();
            const currentIndex = getNearestMobileSnapIndex(points, touchStartScrollY || window.scrollY);
            const nextIndex = Math.max(0, Math.min(points.length - 1, currentIndex + direction));
            return snapToMobileIndex(nextIndex);
        }

        function snapToNearestMobilePoint(delay = 120) {
            window.clearTimeout(nearestSnapTimer);
            if (!isMobileSnapEnabled() || performance.now() < snapLockUntil) {
                return;
            }

            nearestSnapTimer = window.setTimeout(() => {
                if (!isMobileSnapEnabled()) {
                    return;
                }

                snapToMobileIndex(getNearestMobileSnapIndex(getMobileSnapPoints()));
            }, delay);
        }

        function isHorizontalGestureTarget(target) {
            return Boolean(target?.closest?.(horizontalScrollSelector));
        }

        function preventVerticalScroll(event) {
            if (event.cancelable) {
                event.preventDefault();
            }
        }

        function handleMobileTouchStart(event) {
            if (!isMobileSnapEnabled() || event.touches.length !== 1) {
                return;
            }

            const touch = event.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchStartScrollY = window.scrollY;
            touchStartTarget = event.target;
            gestureAxis = null;
            window.clearTimeout(nearestSnapTimer);
        }

        function handleMobileTouchMove(event) {
            if (!isMobileSnapEnabled() || event.touches.length !== 1) {
                return;
            }

            const touch = event.touches[0];
            const deltaX = touch.clientX - touchStartX;
            const deltaY = touch.clientY - touchStartY;

            if (!gestureAxis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 10) {
                gestureAxis = Math.abs(deltaX) > Math.abs(deltaY) + 6 ? "x" : "y";
            }

            if (gestureAxis === "x" && isHorizontalGestureTarget(touchStartTarget)) {
                return;
            }

            if (gestureAxis === "y") {
                preventVerticalScroll(event);
            }
        }

        function handleMobileTouchEnd(event) {
            if (!isMobileSnapEnabled()) {
                return;
            }

            const touch = event.changedTouches[0];
            if (!touch) {
                snapToNearestMobilePoint();
                return;
            }

            const deltaX = touch.clientX - touchStartX;
            const deltaY = touch.clientY - touchStartY;

            if (Math.abs(deltaX) > Math.abs(deltaY) + 8 && isHorizontalGestureTarget(touchStartTarget)) {
                return;
            }

            if (Math.abs(deltaY) < snapInputThreshold) {
                snapToNearestMobilePoint(80);
                return;
            }

            const direction = deltaY < 0 ? 1 : -1;
            snapByMobileDirection(direction);
        }

        function handleMobileWheel(event) {
            if (!isMobileSnapEnabled() || Math.abs(event.deltaY) < 10) {
                return;
            }

            preventVerticalScroll(event);

            if (performance.now() < snapLockUntil) {
                return;
            }

            touchStartScrollY = window.scrollY;
            snapByMobileDirection(event.deltaY > 0 ? 1 : -1);
        }

        document.addEventListener("touchstart", handleMobileTouchStart, { passive: true });
        document.addEventListener("touchmove", handleMobileTouchMove, { passive: false });
        document.addEventListener("touchend", handleMobileTouchEnd, { passive: true });
        window.addEventListener("wheel", handleMobileWheel, { passive: false });
        window.addEventListener("resize", () => snapToNearestMobilePoint(180), { passive: true });
        mobileQuery.addEventListener?.("change", () => snapToNearestMobilePoint(0));
    }

    initMobilePageSnap();

    document.querySelectorAll(".faq-item").forEach((item) => {
        const summary = item.querySelector("summary");
        const panel = item.querySelector(".faq-panel");

        if (!summary || !panel) {
            return;
        }

        item.dataset.faqEnhanced = "true";
        panel.style.height = item.open ? `${panel.scrollHeight}px` : "0px";

        item.addEventListener("click", (event) => {
            if (!event.target.closest("summary")) {
                return;
            }

            event.preventDefault();

            const isOpen = item.open;
            panel.style.overflow = "hidden";

            if (isOpen) {
                panel.style.height = `${panel.scrollHeight}px`;
                panel.offsetHeight;
                panel.style.height = "0px";
                window.setTimeout(() => {
                    item.open = false;
                }, 280);
                return;
            }

            item.open = true;
            panel.style.height = "0px";
            panel.offsetHeight;
            panel.style.height = `${panel.scrollHeight}px`;
        }, true);

        item.addEventListener("toggle", () => {
            if (!item.open || panel.style.height !== "0px") {
                return;
            }

            window.requestAnimationFrame(() => {
                panel.style.height = `${panel.scrollHeight}px`;
            });
        });

        panel.addEventListener("transitionend", (event) => {
            if (event.propertyName !== "height" || !item.open) {
                return;
            }

            panel.style.height = "auto";
            panel.style.overflow = "";
        });
    });

    if (isSnapPage) {
        const snapTargets = Array.from(document.querySelectorAll("[data-snap-anchor]"));
        let requestedSnapIndex = null;
        let lastSnapInputAt = 0;
        let snapLockUntil = 0;
        let scrollSettleTimer = 0;

        function getNearestSnapIndex(points, scrollTop = window.scrollY) {
            let nearestIndex = 0;
            let nearestDistance = Number.POSITIVE_INFINITY;

            points.forEach((point, index) => {
                const distance = Math.abs(point.top - scrollTop);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            });

            return nearestIndex;
        }

        function getSnapPoints() {
            const targets = snapTargets
                .flatMap((element) => {
                    if (element === visualFlow) {
                        const snapMetrics = getVisualFlowSnapMetrics();
                        if (!snapMetrics || !snapMetrics.flowMetrics) {
                            return [];
                        }

                        const cardCount = Math.max(1, scrollShowcaseCards.length);
                        const segment = cardCount > 1
                            ? snapMetrics.flowMetrics.availableScroll / (cardCount - 1)
                            : 0;

                        return Array.from({ length: cardCount }, (_, index) => ({
                            element,
                            kind: "visual-flow-step",
                            top: Math.round(snapMetrics.entryTop + (segment * index))
                        }));
                    }

                    if (element.classList.contains("faq-section")) {
                        return [{
                            element,
                            kind: "default",
                            top: Math.round(element.getBoundingClientRect().top + window.scrollY)
                        }];
                    }

                    return [{
                        element,
                        kind: "default",
                        top: getScrollDestination(element)
                    }];
                })
                .sort((left, right) => left.top - right.top);

            return [{ element: null, kind: "top", top: 0 }, ...targets]
                .filter((point, index, points) => index === 0 || Math.abs(point.top - points[index - 1].top) > 6);
        }

        function syncRequestedSnapIndex() {
            window.clearTimeout(scrollSettleTimer);
            scrollSettleTimer = window.setTimeout(() => {
                requestedSnapIndex = getNearestSnapIndex(getSnapPoints());
            }, 120);
        }

        function moveToSnapIndex(nextIndex, points) {
            const currentIndex = requestedSnapIndex ?? getNearestSnapIndex(points);
            const isVisualFlowMove = points[currentIndex]?.kind === "visual-flow-step"
                || points[nextIndex]?.kind === "visual-flow-step";

            requestedSnapIndex = nextIndex;
            lastSnapInputAt = performance.now();
            snapLockUntil = lastSnapInputAt + (isVisualFlowMove ? 620 : 520);
            window.scrollTo({
                top: points[nextIndex].top,
                behavior: "smooth"
            });
            syncRequestedSnapIndex();
        }

        requestedSnapIndex = getNearestSnapIndex(getSnapPoints());
        window.addEventListener("scroll", syncRequestedSnapIndex, { passive: true });

        window.addEventListener("wheel", (event) => {
            if (!isDesktopSnapEnabled() || body.classList.contains("menu-open-body")) {
                return;
            }

            if (Math.abs(event.deltaY) < 10) {
                return;
            }

            const now = performance.now();
            const direction = event.deltaY > 0 ? 1 : -1;
            const snapPoints = getSnapPoints();

            if (now < snapLockUntil || (now - lastSnapInputAt) < 90) {
                event.preventDefault();
                return;
            }

            const currentIndex = requestedSnapIndex ?? getNearestSnapIndex(snapPoints);
            const currentTarget = snapPoints[currentIndex]?.element || null;

            if (direction > 0 && flushDelayedReveals(currentTarget)) {
                lastSnapInputAt = now;
                event.preventDefault();
                syncRequestedSnapIndex();
                return;
            }

            const nextIndex = Math.max(0, Math.min(snapPoints.length - 1, currentIndex + direction));
            if (nextIndex === currentIndex) {
                return;
            }

            moveToSnapIndex(nextIndex, snapPoints);
            event.preventDefault();
        }, { passive: false });
    }

    initScrollShowcase();
    initMobileShowcaseZoom();

    const videos = document.querySelectorAll("video");
    videos.forEach((video) => {
        video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => {
                // Ignore final autoplay failure.
            });
        });
    });

    if (revealItems.length > 0) {
        if ("IntersectionObserver" in window && !prefersReducedMotion.matches) {
            const revealObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    const element = entry.target;
                    const delay = Number.parseInt(element.getAttribute("data-delay") || "0", 10);

                    clearRevealTimer(element);

                    if (entry.isIntersecting) {
                        const timerId = window.setTimeout(() => {
                            element.classList.add("is-visible");
                            revealTimers.delete(element);
                        }, delay);

                        revealTimers.set(element, timerId);
                    } else {
                        hideReveal(element);
                    }
                });
            }, {
                root: null,
                threshold: 0.2,
                rootMargin: "0px 0px -8% 0px"
            });

            revealItems.forEach((element) => revealObserver.observe(element));
        } else {
            revealItems.forEach((element) => element.classList.add("is-visible"));
        }
    }

    function applyTranslations() {
        if (typeof translations === "undefined") {
            return;
        }

        const requestedLang = new URLSearchParams(window.location.search).get("lang");
        const userLang = (requestedLang || navigator.language.slice(0, 2)).toLowerCase();
        const lang = translations[userLang] ? userLang : "en";
        const dict = translations[lang];
        const missingKeys = [];

        document.documentElement.lang = lang;

        const pageTitleKeys = [
            [document.body.classList.contains("home-page"), "page_title_index"],
            [document.body.classList.contains("about-page-body"), "page_title_about"],
            [window.location.pathname.endsWith("esterni.html"), "page_title_esterni"],
            [window.location.pathname.endsWith("interni.html"), "page_title_interni"],
            [window.location.pathname.endsWith("spazi.html"), "page_title_spaces"],
            [window.location.pathname.endsWith("privacy-policy.html"), "page_title_privacy"]
        ];
        const titleKey = pageTitleKeys.find(([matches]) => matches)?.[1];
        if (titleKey && dict[titleKey]) {
            document.title = dict[titleKey];
        }

        document.querySelectorAll("meta[data-i18n]").forEach((meta) => {
            const key = meta.getAttribute("data-i18n");
            if (key && dict[key]) {
                meta.setAttribute("content", dict[key]);
            } else if (key) {
                missingKeys.push(key);
            }
        });

        document.querySelectorAll("[data-i18n]:not(meta)").forEach((element) => {
            const key = element.getAttribute("data-i18n");
            if (key && dict[key]) {
                element.innerHTML = dict[key];
            } else if (key) {
                missingKeys.push(key);
            }
        });

        document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
            const key = element.getAttribute("data-i18n-aria-label");
            if (key && dict[key]) {
                element.setAttribute("aria-label", dict[key]);
            } else if (key) {
                missingKeys.push(key);
            }
        });

        const languageSignatures = {
            en: dict.hero_title,
            it: dict.case_studies_title,
            sl: dict.faq_title
        };

        window.__qublyTranslationCheck = {
            lang,
            missingKeys: Array.from(new Set(missingKeys)),
            signature: languageSignatures[lang],
            uniqueByLanguage: {
                en: translations.en.hero_title,
                it: translations.it.case_studies_title,
                sl: translations.sl.faq_title
            }
        };

        if (missingKeys.length > 0) {
            console.warn("Missing translation keys:", window.__qublyTranslationCheck.missingKeys);
        }
    }

    applyTranslations();
});
