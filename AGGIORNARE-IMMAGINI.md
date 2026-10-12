# Aggiornare le immagini Qubly

Per sostituire una foto, carica il nuovo originale nella posizione indicata qui
sotto, conserva il nome e conferma il commit su `main`. GitHub rigenera le copie
necessarie, aggiorna dimensioni e collegamenti e cambia la versione degli URL
per evitare immagini vecchie nella cache. Non occorre caricare anche il WebP.

## Dove caricare gli originali

| Immagine | File o cartella |
| --- | --- |
| Le quattro immagini del carosello, nello stesso ordine | `PS/Selezione/01.jpg`, `02.jpg`, `03.jpg`, `04.png` |
| Problema/Soluzione della homepage | `PS/P1.png`…`P6.png` e `PS/S1.png`…`S6.png` |
| Copertine Esterni, Interni e Paesaggi | `PS/exterior.png`, `PS/interior.png`, `PS/paesaggi.png` |
| Foto originali delle gallerie | `PS/esterni`, `PS/interni`, `PS/paesaggi` |
| Foto del catalogo con ID `reviewed-03`, ecc. | `PS/reviewed/03.webp`, ecc. |
| Foto già sostituite tramite il catalogo o Qubly Tools | `PS/managed/<ID-foto>.webp`, ad esempio `reviewed-04.webp` |
| Sfondo delle pagine | `Sfondo.webp` |
| Logo visibile nell'intestazione e nel caricamento | `logo-loader.webp` |
| Logo per i metadati | `logo.png` |
| Icona del browser | `favicon.png` |
| Immagine di attesa del video | Il file `hero-…-poster.webp` effettivamente richiamato in `index.html` |

Puoi usare JPG, JPEG, PNG, WebP o AVIF, anche cambiando estensione e mantenendo
lo stesso nome di base. Se esistono più formati dello stesso originale, viene
usato quello che hai cambiato dall'ultimo aggiornamento automatico. Se ne
carichi più di uno insieme, la precedenza è JPG, JPEG, PNG, WebP, AVIF.

Per le foto del catalogo puoi continuare a usare il catalogo visivo o Qubly
Tools: ordine, ID, titoli nelle tre lingue e foto rimosse vengono conservati.
La cartella `PS/managed` contiene gli originali delle sostituzioni già
pubblicate; se una foto ha una sostituzione attiva, modifica questa versione.

Per aggiungere una foto nelle gallerie originali usa il numero successivo a due
cifre, per esempio `10.jpg`. Per aggiungere nuove foto al catalogo usa Qubly
Tools. Il caricamento di `05.jpg` in `PS/Selezione` non aggiunge una quinta
slide: cambiare il numero di slide richiede anche una modifica alla homepage.

## Cosa viene aggiornato

- Tutte le varianti responsive delle foto sostituite, senza ingrandire immagini
  piccole: 640 px, 1280 px e fino a 1920 px; lo sfondo resta limitato a 1280 px.
- `src`, `srcset`, precaricamento, dimensioni e immagini a tutto schermo.
- Loghi, favicon, poster, immagini dei metadati e sfondi CSS, con URL versionati.
- I riferimenti ai CSS e JavaScript aggiornati, per rinnovare anche la loro cache.
- Il catalogo visivo delle gallerie.

Anche i file SVG, GIF e ICO usati dal sito ricevono un URL aggiornato quando
vengono sostituiti; conservano il loro formato. La generazione di varianti
fotografiche riguarda immagini statiche.

È preferibile sostituire gli originali indicati sopra. Se carichi direttamente
una copia in `assets/optimized`, l'automazione usa la copia cambiata per
aggiornare l'intera famiglia e conserva un originale in `PS`. Se cambi più
copie insieme usa quella con la maggiore larghezza dichiarata nel nome. Se
cambi insieme originale e copie ottimizzate, prevale l'originale.

## Pubblicazione e verifica

1. Conferma il caricamento sul ramo `main`.
2. In **Actions → Ottimizza immagini Qubly** attendi il completamento verde.
3. Quando necessario appare un secondo commit:
   `Aggiorna automaticamente le varianti WebP`.
4. Attendi che Cloudflare completi la pubblicazione di quel commit.

Il completamento dell'automazione GitHub e quello della pubblicazione Cloudflare
sono due stati distinti. Se un passaggio fallisce, apri i dettagli del relativo
controllo. Puoi rilanciare l'ottimizzazione da **Run workflow → main**.

`scripts/image-state.json` è un registro generato: conserva la scelta del
formato originale e gli hash dei file. Non modificarlo o eliminarlo manualmente.
