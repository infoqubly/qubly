document.addEventListener("DOMContentLoaded", () => {
    const body = document.body;
    const menuToggle = document.querySelector(".menu-toggle");
    const fullscreenMenu = document.querySelector(".fullscreen-menu");
    const menuLinks = [...document.querySelectorAll(".menu-item a")];
    const visualFlow = document.getElementById("visual-flow");
    const scrollShowcaseCards = [...document.querySelectorAll(".scroll-showcase-card")];
    const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const requestedLanguage = new URLSearchParams(location.search).get("lang");
    const language = (requestedLanguage || navigator.language.slice(0, 2)).toLowerCase();
    const dict = typeof translations !== "undefined" ? (translations[language] || translations.en) : {};
    const ui = key => dict[key] || key;
    const scrollBehavior = (distance = 0) => prefersReducedMotion.matches || Math.abs(distance) > innerHeight * 1.5 ? "auto" : "smooth";
    let activeLayer = null;
    let inertElements = [];
    let statusTimer = 0;
    if (fullscreenMenu) {
        fullscreenMenu.inert = true;
        fullscreenMenu.setAttribute("aria-hidden", "true");
    }

    function activateLayer(layer, trigger, controls) {
        activeLayer = { layer, trigger, controls };
        const allowedRoots = layer === fullscreenMenu ? [layer, document.querySelector(".site-header")] : [layer];
        const siblings = [...body.children].filter(el => !allowedRoots.includes(el) && !el.matches("script, style, link"));
        if (layer === fullscreenMenu) siblings.push(document.querySelector(".logo"));
        inertElements = siblings.filter(Boolean).map(el => [el, el.inert]);
        inertElements.forEach(([el]) => { el.inert = true; });
        controls[0]?.focus({ preventScroll: true });
    }

    function deactivateLayer() {
        inertElements.forEach(([el, wasInert]) => { el.inert = wasInert; });
        inertElements = [];
        activeLayer = null;
    }

    function closeMenu(restoreFocus = true) {
        if (!fullscreenMenu?.classList.contains("active")) return;
        deactivateLayer();
        body.classList.remove("menu-open-body");
        menuToggle.classList.remove("menu-open");
        fullscreenMenu.classList.remove("active");
        menuToggle.setAttribute("aria-expanded", "false");
        fullscreenMenu.setAttribute("aria-hidden", "true");
        fullscreenMenu.inert = true;
        if (restoreFocus) menuToggle.focus({ preventScroll: true });
    }

    menuToggle?.addEventListener("click", () => {
        if (fullscreenMenu.classList.contains("active")) return closeMenu();
        body.classList.add("menu-open-body");
        menuToggle.classList.add("menu-open");
        fullscreenMenu.classList.add("active");
        fullscreenMenu.inert = false;
        fullscreenMenu.setAttribute("aria-hidden", "false");
        menuToggle.setAttribute("aria-expanded", "true");
        activateLayer(fullscreenMenu, menuToggle, [...menuLinks, menuToggle]);
    });

    document.addEventListener("keydown", event => {
        if (!activeLayer) return;
        if (event.key === "Escape") closeMenu();
        if (event.key !== "Tab" || !activeLayer) return;
        const controls = activeLayer.controls;
        const index = controls.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) {
            event.preventDefault(); controls.at(-1)?.focus();
        } else if (!event.shiftKey && (index === controls.length - 1 || index === -1)) {
            event.preventDefault(); controls[0]?.focus();
        }
    });
    window.addEventListener("pageshow", () => closeMenu(false));

    function scrollToTarget(target) {
        if (!target) return;
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: scrollBehavior(target.getBoundingClientRect().top), block: "start" });
    }

    document.addEventListener("click", event => {
        const link = event.target.closest("a[href]");
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || url.pathname !== location.pathname || link.target === "_blank") return;
        if (!url.hash) {
            if (link.classList.contains("logo") && location.pathname === "/") {
                event.preventDefault(); closeMenu(false);
                window.scrollTo({ top: 0, behavior: scrollBehavior(scrollY) });
            }
            return;
        }
        let target;
        try { target = document.getElementById(decodeURIComponent(url.hash.slice(1))); } catch { return; }
        if (!target) return;
        event.preventDefault();
        closeMenu(false);
        if (location.hash !== url.hash) history.pushState(null, "", url);
        scrollToTarget(target);
    });
    menuLinks.forEach(link => link.addEventListener("click", event => {
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) closeMenu(false);
    }));

    document.querySelectorAll(".contact-trigger-link").forEach(trigger => {
        trigger.addEventListener("click", async event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            const email = "info.qubly@gmail.com";
            try {
                await navigator.clipboard.writeText(email);
                const status = document.getElementById("site-status");
                if (status) {
                    clearTimeout(statusTimer);
                    status.textContent = ui("email_copied");
                    statusTimer = setTimeout(() => { status.textContent = ""; }, 3000);
                }
            } catch { location.href = "mailto:" + email; }
        });
    });

    document.querySelectorAll(".faq-item").forEach(item => {
        const summary = item.querySelector("summary");
        const panel = item.querySelector(".faq-panel");
        if (!summary || !panel) return;
        let animation = null;
        let expanded = item.open;
        summary.addEventListener("click", event => {
            if (prefersReducedMotion.matches || !panel.animate) return;
            event.preventDefault();
            const startHeight = item.open ? panel.getBoundingClientRect().height : 0;
            expanded = !expanded;
            animation?.cancel();
            item.open = true;
            animation = panel.animate({height:[startHeight + "px", (expanded ? panel.scrollHeight : 0) + "px"]},
                {duration:220,easing:"cubic-bezier(0.22,1,0.36,1)"});
            animation.onfinish = () => {item.open = expanded; animation = null;};
        });
        item.addEventListener("toggle", () => {if (!animation) expanded = item.open;});
        prefersReducedMotion.addEventListener("change", () => {
            animation?.cancel(); animation = null; item.open = expanded;
        });
    });

    const revealItems = [...document.querySelectorAll(".reveal")];
    if ("IntersectionObserver" in window && !prefersReducedMotion.matches) {
        const observer = new IntersectionObserver(entries => entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.remove("reveal-pending");
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
        }), {threshold:0,rootMargin:"0px 0px 40px 0px"});
        revealItems.forEach(el => {
            el.style.transitionDelay = Math.min(120,Number(el.dataset.delay)||0) + "ms";
            el.classList.add("reveal-pending"); observer.observe(el);
        });
        prefersReducedMotion.addEventListener("change", () => {
            if (!prefersReducedMotion.matches) return;
            observer.disconnect();
            revealItems.forEach(el => {el.classList.remove("reveal-pending");el.classList.add("is-visible");});
        });
    } else revealItems.forEach(el => el.classList.add("is-visible"));

    function initShowcaseCarousel() {
        if (!visualFlow || scrollShowcaseCards.length < 2) return;

        const stack = visualFlow.querySelector(".scroll-showcase-stack");
        const stage = visualFlow.querySelector(".scroll-showcase-stage");
        const track = visualFlow.querySelector(".scroll-showcase-track");
        const counter = visualFlow.querySelector("[data-showcase-current]");
        const previous = visualFlow.querySelector(".showcase-previous");
        const next = visualFlow.querySelector(".showcase-next");
        const desktopQuery = matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)");
        if (!stack || !stage || !track || !counter || !previous || !next) return;

        let enhanced = false;
        let start = 0;
        let step = 1;
        let activeIndex = -1;
        let lastProgress = -1;
        let frame = 0;

        function setActive(index) {
            index = Math.max(0, Math.min(scrollShowcaseCards.length - 1, index));
            if (index === activeIndex) return;
            activeIndex = index;
            counter.textContent = String(index + 1).padStart(2, "0");
            previous.disabled = index === 0;
            next.disabled = index === scrollShowcaseCards.length - 1;
            scrollShowcaseCards.forEach((card, cardIndex) => {
                card.classList.toggle("is-active", cardIndex === index);
                if (enhanced) card.setAttribute("aria-hidden", String(cardIndex !== index));
                else card.removeAttribute("aria-hidden");
            });
        }

        function updateDesktop() {
            frame = 0;
            if (!enhanced) return;
            const progress = Math.max(0, Math.min(scrollShowcaseCards.length - 1, (scrollY - start) / step));
            if (Math.abs(progress - lastProgress) < 0.001) return;
            lastProgress = progress;
            scrollShowcaseCards.forEach((card, index) => {
                const offset = index === 0 ? 0 : Math.max(0, Math.min(1, index - progress));
                card.style.transform = `translate3d(0, ${offset * 100}%, 0)`;
            });
            setActive(Math.round(progress));
        }

        function updateTrack() {
            frame = 0;
            if (enhanced) return;
            const distance = scrollShowcaseCards[1].offsetLeft - scrollShowcaseCards[0].offsetLeft;
            setActive(Math.round(track.scrollLeft / Math.max(1, distance)));
        }

        function scheduleUpdate() {
            if (frame) return;
            frame = requestAnimationFrame(enhanced ? updateDesktop : updateTrack);
        }

        function measure() {
            if (!enhanced) return;
            const stickyTop = parseFloat(getComputedStyle(stage).top) || 0;
            start = scrollY + stack.getBoundingClientRect().top - stickyTop;
            step = Math.max(1, (stack.offsetHeight - stage.offsetHeight) / (scrollShowcaseCards.length - 1));
            lastProgress = -1;
            scheduleUpdate();
        }

        function configure() {
            enhanced = desktopQuery.matches && !prefersReducedMotion.matches;
            visualFlow.classList.toggle("is-enhanced", enhanced);
            scrollShowcaseCards.forEach(card => {
                card.style.transform = "";
                card.removeAttribute("aria-hidden");
            });
            activeIndex = -1;
            lastProgress = -1;
            cancelAnimationFrame(frame);
            frame = 0;
            if (enhanced) {
                track.scrollLeft = 0;
                requestAnimationFrame(measure);
            } else {
                updateTrack();
            }
        }

        function goTo(index) {
            index = Math.max(0, Math.min(scrollShowcaseCards.length - 1, index));
            if (enhanced) {
                scrollTo({ top: start + index * step, behavior: "smooth" });
            } else {
                const left = scrollShowcaseCards[index].offsetLeft - scrollShowcaseCards[0].offsetLeft;
                track.scrollTo({ left, behavior: prefersReducedMotion.matches ? "auto" : "smooth" });
            }
        }

        previous.addEventListener("click", () => goTo(activeIndex - 1));
        next.addEventListener("click", () => goTo(activeIndex + 1));
        visualFlow.addEventListener("keydown", event => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key) ||
                !visualFlow.contains(document.activeElement) ||
                document.activeElement.classList.contains("scroll-showcase-card")) return;
            event.preventDefault();
            goTo(activeIndex + (event.key === "ArrowRight" ? 1 : -1));
        });
        window.addEventListener("scroll", () => { if (enhanced) scheduleUpdate(); }, { passive: true });
        track.addEventListener("scroll", () => { if (!enhanced) scheduleUpdate(); }, { passive: true });
        window.addEventListener("resize", measure, { passive: true });
        desktopQuery.addEventListener("change", configure);
        prefersReducedMotion.addEventListener("change", configure);
        if ("ResizeObserver" in window) new ResizeObserver(measure).observe(stack);
        if ("IntersectionObserver" in window) {
            new IntersectionObserver(([entry]) => {
                visualFlow.classList.toggle("is-in-view", entry.isIntersecting);
            }).observe(visualFlow);
        }
        visualFlow.classList.add("is-ready");
        configure();
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
        let zoomTrigger = null;

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
            overlay.setAttribute("role", "dialog");
            overlay.setAttribute("aria-modal", "true");
            overlay.setAttribute("aria-label", ui("image_preview"));

            const slideMarkup = scrollShowcaseCards.map((card, index) => {
                const image = card.querySelector("img");
                const src = image?.src || image?.currentSrc || image?.getAttribute("src") || "";
                const alt = image?.getAttribute("alt") || "";
                const tagMarkup = Array.from(card.querySelectorAll(".showcase-tags span"))
                    .map((tag) => tag.textContent.trim())
                    .filter(Boolean)
                    .map((text) => `<span>${escapeHtml(text)}</span>`)
                    .join("");
                return `
                    <div class="mobile-showcase-zoom-slide" data-index="${index}">
                        <div class="mobile-showcase-zoom-frame">
                            <img src="${src}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" draggable="false">
                        </div>
                        <div class="mobile-showcase-zoom-tags">${tagMarkup}</div>
                    </div>
                `;
            }).join("");

            overlay.innerHTML = `
                <button class="mobile-showcase-zoom-close" type="button" aria-label="${ui("close_preview")}"></button>
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
                duration: 320,
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
            closeMenu(false);
            zoomTrigger = card;
            setActiveSlide(index);
            slides[activeIndex].querySelector("img").loading = "eager";
            overlay.classList.add("is-open");
            overlay.setAttribute("aria-hidden", "false");
            body.classList.add("mobile-showcase-zoom-open");
            activateLayer(overlay, card, [overlay.querySelector("button")]);

            window.requestAnimationFrame(() => {
                track.scrollLeft = track.clientWidth * activeIndex;
                window.requestAnimationFrame(() => animateZoomFrom(sourceRect, sourceRadius));
            });
        }

        function closeZoom() {
            if (!overlay?.classList.contains("is-open")) {
                return;
            }

            deactivateLayer();
            zoomTrigger?.focus({ preventScroll: true });
            overlay.classList.remove("is-open");
            overlay.setAttribute("aria-hidden", "true");
            body.classList.remove("mobile-showcase-zoom-open");
        }

        scrollShowcaseCards.forEach((card, index) => {
            const syncControl = () => {
                card.tabIndex = mobileQuery.matches ? 0 : -1;
                if (mobileQuery.matches) {
                    card.setAttribute("role", "button");
                    card.setAttribute("aria-label", `${ui("image_preview")}: ${card.querySelector("img").alt}`);
                } else {
                    card.removeAttribute("role");
                    card.removeAttribute("aria-label");
                }
            };
            syncControl();
            mobileQuery.addEventListener("change", syncControl);
            card.addEventListener("keydown", (event) => {
                if (mobileQuery.matches && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    openZoom(index, card);
                }
            });
            card.addEventListener("click", (event) => {
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
            if (overlay?.classList.contains("is-open") && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
                event.preventDefault();
                setActiveSlide(activeIndex + (event.key === "ArrowRight" ? 1 : -1));
                track.scrollTo({left: track.clientWidth * activeIndex, behavior: scrollBehavior()});
            }
        });

        mobileQuery.addEventListener?.("change", () => {
            if (!mobileQuery.matches) {
                closeZoom();
            }
        });
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

        const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
        const pageTitleKeys = [
            [document.body.classList.contains("home-page"), "page_title_index"],
            [document.body.classList.contains("about-page-body"), "page_title_about"],
            [currentPath.endsWith("/esterni") || currentPath.endsWith("/esterni.html"), "page_title_esterni"],
            [currentPath.endsWith("/interni") || currentPath.endsWith("/interni.html"), "page_title_interni"],
            [currentPath.endsWith("/paesaggi") || currentPath.endsWith("/paesaggi.html"), "page_title_landscapes"],
            [currentPath.endsWith("/spazi") || currentPath.endsWith("/spazi.html"), "page_title_spaces"],
            [currentPath.endsWith("/privacy-policy") || currentPath.endsWith("/privacy-policy.html"), "page_title_privacy"]
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
    // Keep an explicitly selected language when following local links.
    if (requestedLanguage && typeof translations !== "undefined" && translations[language]) {
        document.querySelectorAll("a[href]").forEach(link => {
            const url = new URL(link.href,location.href);
            if (url.origin === location.origin && !link.hasAttribute("download") && !/\.(jpg|png|webp)$/i.test(url.pathname)) {
                url.searchParams.set("lang",language);
                link.href = url.pathname + url.search + url.hash;
            }
        });
    }
    initShowcaseCarousel();
    initMobileShowcaseZoom();
});
