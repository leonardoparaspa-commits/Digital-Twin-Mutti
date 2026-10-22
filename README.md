# Digital twin del ricevimento del pomodoro

**Progetto universitario indipendente, non affiliato a Mutti.** Corso Smart Industry, University of Twente, sfida "From Workflow to Wisdom". Il logo e il marchio Mutti non sono usati.

È un digital twin 3D del ricevimento del pomodoro in uno stabilimento di trasformazione durante la campagna. Nella scena si vedono i camion arrivare, aspettare al cancello, passare al carotaggio, scaricare nelle baie e riempire le vasche, minuto per minuto, con i dati dal vivo accanto. Il caso di riferimento è lo stabilimento Mutti di Montechiarugolo (Parma), ricostruito solo da fonti pubbliche. Il modello segue ogni camion dal cancello al carotaggio, all'esito di laboratorio, allo scarico, alle cinque vasche e alla linea di lavorazione. Poi confronta gli arrivi di oggi, senza slot, con arrivi in slot pianificati.

Nel processo to-be del progetto il twin è il passaggio ③: riceve le previsioni di arrivo e propone slot dei camion e piano delle vasche.

## Come si usa

- **La scena**: trascina per ruotare, rotella o due dita per lo zoom. Tocca un camion per vedere il suo percorso e seguirlo con la camera. I pulsanti in alto portano alle viste del cancello e dello scarico.
- **Il tempo**: play e pausa (anche con la barra spaziatrice), quattro velocità, e la linea del tempo da trascinare. La linea rossa è la coda al cancello, quella grigia l'attesa dello scarico; le fasce segnano le ore con la linea senza prodotto o ferma.
- **Scenari e parametri**: a sinistra. Ogni cambio ricalcola i due giorni e la tabella "Come oggi contro slot".

- **Online**: con GitHub Pages attivo, la pagina è servita dalla radice del ramo `main`.
- **In locale**: dalla cartella del progetto lancia `python3 -m http.server 8000` e apri `http://localhost:8000`. La pagina usa moduli JavaScript, quindi non funziona aprendo `index.html` con un doppio clic.
- **Test**: `npm test`. Serve Node 18 o successivo, senza dipendenze da installare.

## Il modello

Il modello avanza di un minuto alla volta per due giorni, così la coda del primo giorno ha il tempo di svuotarsi. Il giorno parte con le vasche piene all'80%, perché l'impianto è già in marcia; all'inizio della campagna partono vuote. Lo stesso insieme di parametri dà sempre lo stesso risultato, perché i numeri casuali hanno un seme fisso.

1. **Arrivo**: il camion entra nella coda del cancello, in ordine di arrivo.
2. **Carotaggio**: una postazione libera prende il primo camion della coda e resta occupata per i minuti del campione.
3. **Laboratorio**: l'esito arriva dopo i minuti di laboratorio, senza tenere occupata la postazione. Con la probabilità indicata il carico è rifiutato e il camion esce dal modello, perché lo vende altrove.
4. **Scarico**: il camion accettato aspetta una baia libera. Entra solo se una vasca ha spazio per tutto il carico: la vasca con più spazio libero viene prenotata e il carico arriva a fine scarico. Se le vasche sono piene, i camion aspettano in coda e le baie restano libere.
5. **Vasche e linea**: la linea prende prodotto dalla vasca più piena alla velocità indicata. Se nelle vasche non c'è abbastanza prodotto, il minuto conta come linea senza prodotto.

### Scenari

| Scenario | Arrivi come oggi | Slot pianificati |
|---|---|---|
| Giorno di picco | il 60% dei camion arriva tra le 6 e le 14, il resto in tutta la giornata | camion distribuiti in modo regolare nelle 24 ore |
| Pioggia e ondata | nessun arrivo per 6 ore, poi tutti i camion tra le 6 e le 18 | dalle 6 in poi, distribuiti in modo regolare |
| Linea ferma | come il giorno di picco, con la linea ferma dalle 10 alle 14 | come il giorno di picco, con la stessa fermata |
| Inizio campagna | 100 camion, stesso profilo del picco, vasche vuote | 100 camion distribuiti in modo regolare, vasche vuote |

Il profilo degli arrivi di oggi è un'ipotesi: va sostituito con gli orari reali di arrivo quando saranno disponibili.

### Indicatori

- **Attesa media al cancello**: minuti tra l'arrivo e l'inizio del carotaggio.
- **Coda massima al cancello**: il numero più alto di camion in attesa del carotaggio.
- **Dall'arrivo allo scarico**: minuti tra l'arrivo e il versamento nella vasca, per i carichi accettati.
- **Linea senza prodotto**: ore in cui la linea è accesa ma le vasche non hanno prodotto, dall'inizio del giorno all'ultimo scarico.
- **Carichi rifiutati** e **tonnellate lavorate** nelle due giornate.

## Parametri

Le cifre vengono da fonti pubbliche o da nostri calcoli. **Reale** indica un numero pubblicato dalla fonte citata, **stima** un nostro calcolo, **da chiedere** un numero interno che solo Mutti può dare. Tutti i valori si cambiano dalla pagina.

| Parametro | Valore iniziale | Tipo | Fonte o calcolo |
|---|---|---|---|
| Camion nel giorno di picco | 260 | reale | [Linkiesta, agosto 2025](https://www.linkiesta.it/2025/08/dentro-ai-campi-delle-conserve-di-pomodoro/) |
| Tonnellate per camion | 24 (da 22 a 27) | stima | 6.000 t ÷ 260 camion ≈ 23 t; 100 t ÷ 4 camion = 25 t |
| Postazioni di carotaggio | 4 (da 3 a 5) | stima | un arrivo ogni 5,5 minuti al picco e un ciclo ipotetico di 15-25 minuti |
| Minuti per campione | 20 | da chiedere | nessun dato pubblico |
| Minuti di laboratorio | 30 | stima | nessun dato pubblico |
| Carichi rifiutati | 2% (da 1 a 3%) | da chiedere | nessun dato pubblico |
| Baie di scarico | 3 | stima | numero non pubblico |
| Minuti per scarico | 16 | stima | 3 baie da 16 minuti danno circa 11 camion all'ora, il ritmo dei 260 camion in 24 ore |
| Vasche | 5 da 100 t | reale | video della visita: 4 camion per vasca |
| Linea | 250 t/h | stima | 6.000 t ÷ 24 ore |
| Vasche all'inizio del giorno | 80% (0% all'inizio campagna) | stima | impianto già in marcia dal giorno prima |
| Ricevimento | 24 ore su 24 | reale | [comunicato Mutti 2022](https://mutti-parma.com/app/uploads/2022/10/cs--mutti-tomato-processing-season-results-2022-def-en-1.pdf) |

Un dato storico di [Terra e Vita](https://terraevita.edagricole.it/fare-filiera/mutti-la-ferrari-del-pomodoro-premia/) parla di 8 camion all'ora in scarico a pieno regime. Con 8 camion all'ora non si scaricano 260 camion in un giorno, quindi o il dato è vecchio, o vale per una sola baia, o al picco lo scarico è più veloce. È una delle domande per l'intervista.

## Limiti

- Mancano tre numeri interni: durata del carotaggio, attese al cancello e quota di carichi rifiutati. Finché non arrivano, il modello mostra meccanismi e ordini di grandezza, non previsioni per lo stabilimento.
- I tempi di carotaggio, laboratorio e scarico sono fissi. Nella realtà variano da camion a camion.
- Il modello non segue la qualità dei carichi (Brix, pH, colore) né la miscelazione nelle vasche.
- La linea lavora a velocità costante, senza avvii lenti o cambi di formato.
- Le fonti sono state lette da estratti di ricerca e vanno aperte e verificate prima della consegna.

## La scena 3D

Il modello scrive per ogni camion un diario: arrivo, postazione e inizio del carotaggio, esito, baia, vasca, inizio e fine dello scarico. Salva anche, minuto per minuto, il livello di ogni vasca, le tonnellate lavorate e lo stato della linea. La scena rilegge questi dati: in ogni istante calcola dove deve stare ogni camion e lo porta lì con un movimento morbido. Non è collegata a dati reali dello stabilimento: è un gemello del modello, pronto a ricevere orari di arrivo veri quando ci saranno.

La pianta è schematica. Le aree (piazzale, cancello, carotaggio, attesa dell'esito, attesa dello scarico, baie, vasche, linea) seguono l'ordine del flusso, non le posizioni reali.

## File

- `index.html`, `styles.css`: la pagina.
- `sim.js`: il modello, senza dipendenze, usato sia dalla pagina sia dai test.
- `layout.js`: la pianta e la posizione di ogni camion in un dato minuto, senza dipendenze.
- `scene.js`: la scena 3D con Three.js.
- `app.js`: collega scenari, parametri, linea del tempo e pannelli al modello e alla scena.
- `vendor/three/`: Three.js 0.169.0 con la sua licenza, incluso nel sito per non dipendere da una CDN.
- `tests/`: controlli del modello (le tonnellate si conservano, ogni camion passa le fasi in ordine, postazioni e baie non sono mai sovraccariche, risultati ripetibili) e della scena (conteggi uguali alle code del modello, nessun posto occupato da due camion).

## Crediti

- [Three.js](https://threejs.org) (licenza MIT).
- Caratteri Public Sans e JetBrains Mono (SIL Open Font License), da Google Fonts.

## Licenza

Codice con licenza MIT, vedi `LICENSE`.
