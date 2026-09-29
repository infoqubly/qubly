# Qubly
Qubly - architectural visualization studio.

## Aggiornare le gallerie fotografiche

Apri il [catalogo visivo](https://qubly.studio/gestione-gallerie.html) da un browser. Serve un account GitHub con permesso di scrittura nel repository `infoqubly/qubly`; non serve avere una copia del sito sul computer.

- Per **sostituire** una foto, seleziona la sezione e premi **Sostituisci** sotto la miniatura. Nella finestra del catalogo controlla i titoli italiano, inglese e sloveno; sono già compilati. Premi **Continua su GitHub**, carica la nuova immagine e invia il modulo. La foto scelta e i titoli passano automaticamente al modulo.
- Per **aggiungere** una foto, premi **Aggiungi foto**, scegli Esterni, Interni o Paesaggi e scrivi i tre titoli nella finestra del catalogo. Su GitHub carica l'immagine e invia il modulo.

I moduli accettano una sola immagine PNG, JPG o WebP per richiesta, fino a 10 MB e almeno 640 × 400 px. Dopo l'invio, GitHub genera le versioni leggere, aggiorna la griglia e pubblica la modifica. L'issue si chiude quando il commit arriva su `main`. Il catalogo legge sempre le gallerie pubblicate e si aggiorna quando torni alla scheda, periodicamente o con **Aggiorna foto**. Non viene effettuata alcuna traduzione automatica dei titoli.

Le nuove foto sono raccolte in un blocco separato della galleria; le sostituzioni conservano posizione e ID della foto. `scripts/gallery_request.py` elabora i moduli, mentre `scripts/optimize_images.py` conserva titoli e sostituzioni quando rigenera le immagini originali.
