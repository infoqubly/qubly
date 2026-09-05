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
