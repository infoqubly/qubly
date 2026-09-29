# QUBLY Tools · Gestione gallerie

Il catalogo di `gallery/catalog.json` è l'ordine pubblicato di Esterni, Interni e Paesaggi. La pagina in `infoqubly/qubly-tools` legge il catalogo tramite `/api/gallery/catalog` e chiede l'accesso GitHub soltanto quando un collaboratore modifica una foto o l'ordine.

## Attivazione una tantum

1. Registra una **GitHub App privata** nell'account `infoqubly`. Homepage: `https://infoqubly.github.io/qubly-tools/`. Callback: `https://qubly.studio/api/gallery/auth/callback`. Non serve un webhook. Abilita solo il permesso repository **Contents: Read and write**; lascia gli altri permessi sul minimo predefinito.
2. Installa la GitHub App scegliendo **Only select repositories** e solo `infoqubly/qubly`.
3. Genera un client secret nell'app. Nel Worker Cloudflare `qubly` configura i segreti `GALLERY_CLIENT_ID`, `GALLERY_CLIENT_SECRET` e `GALLERY_SESSION_KEY`. Quest'ultimo è una chiave casuale di 32 byte codificata in base64url; non inserirli mai nel repository.
4. Pubblica sia `infoqubly/qubly` sia `infoqubly/qubly-tools`, poi verifica accesso, sostituzione, aggiunta e riordino da `https://infoqubly.github.io/qubly-tools/gestione-gallerie.html`.

L'app agisce con il permesso comune all'app installata e al collaboratore GitHub. La sessione del browser scade dopo un'ora; il token GitHub rimane cifrato nel Worker e non viene consegnato alla pagina Tools.

## Pubblicazione

- Una nuova immagine o una sostituzione crea un file di richiesta e un'immagine in `gallery/inbox/` in un unico commit. L'azione `gallery-tools.yml` convalida il file, genera WebP responsivi, aggiorna pagina e catalogo e rimuove i file temporanei.
- Il riordino aggiorna solo `gallery/catalog.json`; la stessa azione riordina gli elementi nell'HTML, inclusa la priorità di caricamento delle prime due foto.
- `scripts/optimize_images.py` mantiene l'ordine scelto anche quando rigenera le immagini sorgente.
- Il vecchio percorso `/gestione-gallerie` rimanda al tool. Le issue form già aperte continuano a funzionare e sincronizzano il catalogo.
