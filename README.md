# Qubly
Qubly - architectural visualization studio.

## Aggiornare le gallerie fotografiche

Apri il [catalogo visivo](https://qubly.studio/gestione-gallerie.html) da un browser. Serve un account GitHub con permesso di scrittura nel repository `infoqubly/qubly`; non serve avere una copia del sito sul computer.

- Per **sostituire** una foto, seleziona la sezione e premi **Sostituisci** sotto la miniatura. Il modulo GitHub riceve già l'ID della foto. Carica una nuova immagine; puoi lasciare vuoti i titoli per conservare quelli esistenti.
- Per **aggiungere** una foto, premi **Aggiungi foto**, scegli Esterni, Interni o Paesaggi, scrivi un titolo breve e carica l'immagine.

I moduli accettano una sola immagine PNG, JPG o WebP per richiesta, fino a 10 MB e almeno 640 × 400 px. Dopo l'invio, GitHub genera le versioni leggere, aggiorna la griglia e pubblica la modifica. L'issue si chiude quando il commit arriva su `main`. I titoli inglese e sloveno sono facoltativi; se mancano, viene usato l'italiano.

Le nuove foto sono raccolte in un blocco separato della galleria; le sostituzioni conservano posizione e ID della foto. `scripts/gallery_request.py` elabora i moduli, mentre `scripts/optimize_images.py` conserva titoli e sostituzioni quando rigenera le immagini originali.
