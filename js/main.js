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
    const scrollBehavior = () => prefersReducedMotion.matches ? "instant" : "smooth";
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
        target.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    }

    document.addEventListener("click", event => {
        const link = event.target.closest("a[href]");
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || url.pathname !== location.pathname || link.target === "_blank") return;
        if (!url.hash) {
            if (link.classList.contains("logo") && location.pathname === "/") {
                event.preventDefault(); closeMenu(false);
                window.scrollTo({ top: 0, behavior: scrollBehavior() });
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

    function initScrollShowcase() {
        if (!visualFlow || !scrollShowcaseCards.length) return;
        const desktop = matchMedia("(min-width: 768px)");
        const stack = visualFlow.querySelector(".scroll-showcase-stack");
        const stage = visualFlow.querySelector(".scroll-showcase-stage");
        const cards = scrollShowcaseCards.map((card, index) => ({card, image:card.querySelector("img"), index}));
        let metrics = null;
        let frame = 0;
        let nearViewport = true;
        let previousMode = "";
        let previousProgress = -1;
        const enhanced = () => desktop.matches && !prefersReducedMotion.matches;
        function measure() {
            frame = 0;
            const enabled = enhanced();
            visualFlow.classList.toggle("is-enhanced", enabled);
            if (!enabled) {
                stage.removeAttribute("style");
                cards.forEach(({card,image}) => {card.removeAttribute("style"); image.style.transform = "";});
                metrics = null;
                return;
            }
            const rect = stack.getBoundingClientRect();
            const rawTop = getComputedStyle(visualFlow).getPropertyValue("--showcase-stage-top").trim();
            const top = parseFloat(rawTop) * (rawTop.endsWith("vh") ? innerHeight / 100 : 1);
            const height = stage.offsetHeight;
            metrics = {top, height, start:rect.top + scrollY - top, length:Math.max(1,stack.offsetHeight-height),left:rect.left,width:rect.width};
            previousMode = ""; previousProgress = -1;
            cards.forEach(({card,index}) => {card.style.zIndex = index + 1;});
            update();
        }
        function update() {
            frame = 0;
            if (!metrics || !enhanced()) return;
            const m = metrics;
            const distance = Math.max(0, Math.min(m.length, scrollY - m.start));
            const mode = scrollY <= m.start ? "before" : scrollY >= m.start + m.length ? "after" : "pinned";
            if (mode !== previousMode) {
                stage.style.position = mode === "pinned" ? "fixed" : "absolute";
                stage.style.top = (mode === "pinned" ? m.top : mode === "after" ? m.length : 0) + "px";
                stage.style.left = mode === "pinned" ? m.left + "px" : "0";
                stage.style.width = mode === "pinned" ? m.width + "px" : "100%";
                previousMode = mode;
            }
            if (distance === previousProgress) return;
            previousProgress = distance;
            const progress = distance / (m.length / Math.max(1,cards.length - 1));
            const active = Math.min(cards.length - 1,Math.floor(progress + 0.55));
            cards.forEach(({card,image,index}) => {
                const local = index === 0 ? 1 : Math.max(0,Math.min(1,progress - index + 1));
                const translate = index === 0 ? 0 : Math.min(116,104 + (index - 1)*2) * Math.pow(1-local,3);
                const speed = parseFloat(image.dataset.speed || "0.92");
                const shift = index === 0 ? -distance*0.012 : -(translate/100*m.height)*(1-speed+0.14);
                card.classList.toggle("is-active", index === active);
                card.style.transform = "translate3d(0," + translate.toFixed(3) + "%,0)";
                card.style.opacity = index === 0 || local > 0 ? "1" : "0";
                image.style.transform = "translate3d(0," + shift.toFixed(2) + "px,0) scale(1.035)";
            });
        }
        function schedule() {
            if (!frame && nearViewport && enhanced() && !document.hidden) frame = requestAnimationFrame(update);
        }
        function scheduleMeasure() { if (frame) cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); }
        addEventListener("scroll", schedule, {passive:true});
        addEventListener("resize", scheduleMeasure, {passive:true});
        addEventListener("pageshow", scheduleMeasure);
        prefersReducedMotion.addEventListener("change", scheduleMeasure);
        desktop.addEventListener("change", scheduleMeasure);
        if ("ResizeObserver" in window) new ResizeObserver(scheduleMeasure).observe(stack);
        if ("IntersectionObserver" in window) new IntersectionObserver(([entry]) => {
            nearViewport = entry.isIntersecting;
            visualFlow.classList.toggle("is-in-view", nearViewport);
            // Apply the final position once on exit, then stop offscreen work.
            if (!nearViewport) update(); else schedule();
        }, {rootMargin:"100px"}).observe(visualFlow);
        measure();
    }

    const caseGroups = [...document.querySelectorAll(".case-group")];
    if ("IntersectionObserver" in window) {
        const titles = new IntersectionObserver(entries => entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-title-filling");
                titles.unobserve(entry.target);
            }
        }), {threshold:0.15});
        caseGroups.forEach(group => titles.observe(group));
    } else caseGroups.forEach(group => group.classList.add("is-title-filling"));

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
    initScrollShowcase();
    initMobileShowcaseZoom();
});
