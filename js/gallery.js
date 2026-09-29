import PhotoSwipeLightbox from '../vendor/photoswipe/photoswipe-lightbox.esm.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const lang = (new URLSearchParams(location.search).get('lang') || navigator.language.slice(0, 2)).toLowerCase();
const labels = {
    it: {closeTitle:'Chiudi',zoomTitle:'Ingrandisci',arrowPrevTitle:'Immagine precedente',arrowNextTitle:'Immagine successiva',errorMsg:'Impossibile caricare l’immagine. Chiudi e riprova.'},
    sl: {closeTitle:'Zapri',zoomTitle:'Povečaj',arrowPrevTitle:'Prejšnja slika',arrowNextTitle:'Naslednja slika',errorMsg:'Slike ni mogoče naložiti. Zaprite in poskusite znova.'}
};
const lightbox = new PhotoSwipeLightbox({
    gallery: '#gallery',
    children: 'a.masonry-item',
    pswpModule: () => import('../vendor/photoswipe/photoswipe.esm.js'),
    showHideAnimationType: reducedMotion.matches ? 'none' : 'zoom',
    showAnimationDuration: 280,
    hideAnimationDuration: 220,
    preload: [1, 1],
    ...(labels[lang] || {})
});
reducedMotion.addEventListener('change', () => {
    lightbox.options.showHideAnimationType = reducedMotion.matches ? 'none' : 'zoom';
    if (lightbox.pswp) lightbox.pswp.options.showHideAnimationType = lightbox.options.showHideAnimationType;
});
lightbox.init();

function initBentoHoverGallery() {
    const gallery = document.querySelector('.masonry-gallery');
    const items = [...(gallery?.querySelectorAll('.masonry-item') || [])];
    if (!gallery || items.length < 2) return;

    const desktop = matchMedia('(min-width: 1025px) and (hover: hover) and (pointer: fine)');
    let slots = [];
    let columnCount = 0;
    let baseColumns = [];
    let rowCount = 0;
    let active = -1;
    let resizeFrame = 0;

    function tracks(count, first = -1, span = 0, base = []) {
        return Array.from({ length: count }, (_, index) =>
            `${((base[index] || 1) * (first < 0 ? 1 : index >= first && index < first + span ? 1.5 : 0.8)).toFixed(4)}fr`
        ).join(' ');
    }

    function activate(index) {
        if (!gallery.classList.contains('is-bento') || active === index) return;
        active = index;
        items.forEach((item, itemIndex) => item.classList.toggle('is-expanded', itemIndex === index));
        const slot = slots[index];
        gallery.style.gridTemplateColumns = slot ? tracks(columnCount, slot.column, slot.columnSpan, baseColumns) : tracks(columnCount, -1, 0, baseColumns);
        gallery.style.gridTemplateRows = slot ? tracks(rowCount, slot.row, slot.rowSpan) : tracks(rowCount);
    }

    function measure() {
        resizeFrame = 0;
        gallery.classList.remove('is-bento');
        gallery.style.removeProperty('height');
        gallery.style.removeProperty('grid-template-columns');
        gallery.style.removeProperty('grid-template-rows');
        items.forEach(item => item.classList.remove('is-expanded'));
        active = -1;
        if (!desktop.matches) return;

        const style = getComputedStyle(gallery);
        const bounds = gallery.getBoundingClientRect();
        const gapX = parseFloat(style.columnGap) || 0;
        const gapY = parseFloat(style.rowGap) || 0;
        const columnWidths = style.gridTemplateColumns.trim().split(/\s+/).map(parseFloat);
        columnCount = columnWidths.length;
        const rowHeight = parseFloat(style.gridAutoRows);
        if (columnCount < 2 || columnWidths.some(width => !width) || !rowHeight) return;
        const averageWidth = columnWidths.reduce((sum, width) => sum + width, 0) / columnCount;
        baseColumns = columnWidths.map(width => width / averageWidth);
        const columnStarts = columnWidths.map((_, index) =>
            columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0) + gapX * index
        );
        const closest = (values, point) => values.reduce((best, value, index) =>
            Math.abs(value - point) < Math.abs(values[best] - point) ? index : best, 0
        );

        slots = items.map(item => {
            const box = item.getBoundingClientRect();
            const column = closest(columnStarts, box.left - bounds.left);
            const columnEnd = closest(columnStarts.map((start, index) => start + columnWidths[index]), box.right - bounds.left) + 1;
            return {
                column,
                columnSpan: columnEnd - column,
                row: Math.round((box.top - bounds.top) / (rowHeight + gapY)),
                rowSpan: Math.round((box.height + gapY) / (rowHeight + gapY))
            };
        });
        rowCount = Math.max(...slots.map(slot => slot.row + slot.rowSpan));
        if (!rowCount || slots.some(slot => slot.column < 0 || slot.columnSpan < 1 || slot.column + slot.columnSpan > columnCount)) return;

        // Explicit tracks redistribute the same measured space, so hovering cannot move the next section.
        gallery.style.height = `${bounds.height}px`;
        gallery.style.gridTemplateColumns = tracks(columnCount, -1, 0, baseColumns);
        gallery.style.gridTemplateRows = tracks(rowCount);
        gallery.classList.add('is-bento');
    }

    items.forEach((item, index) => {
        item.addEventListener('pointerenter', () => { if (desktop.matches) activate(index); });
        item.addEventListener('focus', () => { if (desktop.matches) activate(index); });
    });
    gallery.addEventListener('pointerleave', () => {
        if (!gallery.contains(document.activeElement)) activate(-1);
    });
    gallery.addEventListener('focusout', event => {
        if (!gallery.contains(event.relatedTarget) && !gallery.matches(':hover')) activate(-1);
    });
    const scheduleMeasure = () => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(measure);
    };
    desktop.addEventListener('change', scheduleMeasure);
    window.addEventListener('resize', scheduleMeasure, { passive: true });
    measure();
}

initBentoHoverGallery();
