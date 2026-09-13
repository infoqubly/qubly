# Aggiornare le immagini QUBLY

Le varianti WebP e le pagine delle gallerie vengono aggiornate automaticamente da GitHub.

## Esterni, interni e paesaggi

1. Apri una di queste cartelle nel repository:
   - `PS/esterni`
   - `PS/interni`
   - `PS/paesaggi`
2. Carica una sola immagine originale in formato JPG, con un nome numerico a due cifre, per esempio `10.jpg`.
3. Per sostituire un'immagine esistente usa lo stesso nome. Per aggiungerne una nuova usa il numero successivo.
4. Conferma il commit sul ramo `main`.

L'automazione crea le versioni WebP da 640 px, 1280 px e fino a 1920 px, aggiorna dimensioni e collegamenti della galleria e aggiunge una versione anti-cache. Non modificare manualmente `assets/optimized`.

## Immagini Problema/Soluzione della homepage

Carica o sostituisci soltanto il PNG corrispondente nella cartella `PS`, per esempio `P4.png` oppure `S4.png`, quindi conferma il commit. Le varianti WebP vengono rigenerate automaticamente.

## Pubblicazione

Dopo il primo commit GitHub esegue l'automazione e crea, quando necessario, un secondo commit chiamato `Aggiorna automaticamente le varianti WebP`. Cloudflare pubblica quindi il risultato. In genere basta attendere uno o due minuti.
