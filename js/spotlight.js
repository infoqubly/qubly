document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("spotlight-canvas");
    const cursor = document.getElementById("cursor-dot");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = innerWidth;
    let height = innerHeight;
    let radius = 290;
    let frame = 0;
    let visible = true;
    let pointerSeen = false;
    const target = {x: width / 2, y: height / 2};
    const position = {...target};

    function paint() {
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = width >= 768 ? "rgba(0,0,0,0.76)" : "rgba(0,0,0,0.82)";
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = "destination-out";
        const gradient = ctx.createRadialGradient(position.x, position.y, 0, position.x, position.y, radius);
        gradient.addColorStop(0, "rgba(0,0,0,1)");
        gradient.addColorStop(0.3, "rgba(0,0,0,1)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
    }

    function render() {
        frame = 0;
        if (document.hidden) return;
        if (cursor && pointerSeen) cursor.style.transform = `translate3d(${target.x}px,${target.y}px,0) translate(-50%,-50%)`;
        if (!visible) return;
        position.x += (target.x - position.x) * 0.2;
        position.y += (target.y - position.y) * 0.2;
        const unsettled = Math.abs(target.x-position.x) + Math.abs(target.y-position.y) > 0.5;
        if (!unsettled) Object.assign(position, target);
        paint();
        if (unsettled && finePointer.matches && !reducedMotion.matches) schedule();
    }

    function schedule() { if (!frame && !document.hidden) frame = requestAnimationFrame(render); }
    function resize() {
        width = innerWidth; height = innerHeight;
        canvas.width = width; canvas.height = height;
        radius = width >= 768 ? 290 : 250;
        if (!finePointer.matches || reducedMotion.matches || !pointerSeen) {
            target.x = width / 2; target.y = height / 2;
            Object.assign(position, target);
        }
        paint();
    }
    addEventListener("resize", resize, {passive:true});
    finePointer.addEventListener("change", resize);
    reducedMotion.addEventListener("change", resize);
    addEventListener("pointermove", event => {
        if (event.pointerType === "touch" || !finePointer.matches || reducedMotion.matches) return;
        pointerSeen = true;
        target.x = event.clientX; target.y = event.clientY;
        if (cursor) {
            cursor.classList.add("is-tracking");
            cursor.classList.toggle("active", Boolean(event.target.closest("a,button,input,textarea,summary,[role='button']")));
        }
        schedule();
    }, {passive:true});
    document.addEventListener("mouseleave", () => cursor?.classList.remove("is-tracking"));
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {cancelAnimationFrame(frame); frame = 0;} else schedule();
    });
    const content = document.querySelector(".home-page #main-content-wrapper");
    if (content && "IntersectionObserver" in window) {
        new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible) schedule();
        }).observe(content);
    }
    resize();
});
