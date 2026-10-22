# Tomato receiving digital twin

**Independent university project, not affiliated with Mutti.** Smart Industry course, University of Twente, challenge "From Workflow to Wisdom". The Mutti logo and brand are not used.

This is a 3D digital twin of tomato receiving at a processing plant during the harvest. In the scene you watch trucks arrive, queue at the gate, go through core sampling, unload in the bays and fill the tanks, minute by minute, with live data alongside. The reference case is the Mutti plant in Montechiarugolo (Parma, Italy), rebuilt from public sources only. The twin compares today's arrivals, with no slots, against arrivals in planned slots.

In the project's to-be process the twin is step ③: it takes the arrival forecast and proposes truck slots and a tank plan.

## How to use it

- **Scenarios**: the four cards at the top are the main control. Each one changes the day the twin plays.
- **How the trucks arrive**: *Free arrival* means trucks turn up when they like, mostly between 6:00 and 14:00 (our assumption of today). *Planned slots* means each truck gets a time, spread evenly over 24 hours. Nothing else changes, so the difference in the results comes from the arrival times alone. The right panel compares the two for the chosen scenario.
- **The scene**: drag to rotate, scroll or pinch to zoom. Tap a truck to see its journey and follow it with the camera. The buttons at the top of the scene switch to the gate view and the unloading view.
- **Time**: play and pause (also with the space bar), four speeds, and a timeline you can drag. The red line is the gate queue and the white line is the queue to unload; the shaded bands mark hours when the line has no product or is stopped.
- **Assumptions**: the numbers behind the model sit under "Adjust the assumptions", each tagged real, estimate or ask Mutti.

Running it:

- **Online**: with GitHub Pages on, the page is served from the root of the `main` branch.
- **Locally**: from the project folder run `python3 -m http.server 8000` and open `http://localhost:8000`. The page uses JavaScript modules, so it does not work by double-clicking `index.html`.
- **Tests**: `npm test`. Needs Node 18 or later, with nothing to install.

## The model

The model moves one minute at a time over two days, so the first day's queue has time to clear. The day starts with the tanks 80% full, because the plant is already running; at the start of the season they start empty. The same parameters always give the same result, because the random numbers use a fixed seed.

1. **Arrival**: the truck joins the gate queue in order of arrival.
2. **Core sampling**: a free station takes the first truck in the queue and stays busy for the sampling minutes.
3. **Lab**: the result comes after the lab minutes, without holding the station. With the given probability the load is rejected and the truck leaves the model, because it sells the load elsewhere.
4. **Unloading**: an accepted truck waits for a free bay. It goes in only when a tank has room for the whole load: the tank with the most free space is booked and the load arrives when unloading ends. When the tanks are full, trucks wait in the queue and the bays stay free.
5. **Tanks and line**: the line draws product from the fullest tank at the given rate. When the tanks do not hold enough product, that minute counts as line without product.

### Scenarios

| Scenario | Arrivals as today | Planned slots |
|---|---|---|
| Peak day | 60% of trucks arrive between 6:00 and 14:00, the rest across the day | trucks spread evenly over 24 hours |
| Rain and surge | no arrivals for 6 hours, then all trucks between 6:00 and 18:00 | from 6:00 on, spread evenly |
| Line stop | as the peak day, with the line stopped from 10:00 to 14:00 | as the peak day, with the same stop |
| Season start | 100 trucks, same profile as the peak, empty tanks | 100 trucks spread evenly, empty tanks |

Today's arrival profile is an assumption: it should be replaced with real arrival times when they are available.

### Indicators

- **Average wait at the gate**: minutes from arrival to the start of core sampling.
- **Longest gate queue**: the highest number of trucks waiting for core sampling.
- **Arrival to unloaded**: minutes from arrival to the load reaching a tank, for accepted loads.
- **Line without product**: hours when the line is on but the tanks have no product, from the start of the day to the last unload.
- **Rejected loads** and **tonnes processed** over the two days.

## Parameters

The figures come from public sources or our own calculations. **Real** marks a number published by the cited source, **estimate** our own calculation, **ask Mutti** an internal number only Mutti can give. Every value can be changed on the page.

| Parameter | Starting value | Type | Source or calculation |
|---|---|---|---|
| Trucks on a peak day | 260 | real | [Linkiesta, August 2025](https://www.linkiesta.it/2025/08/dentro-ai-campi-delle-conserve-di-pomodoro/) (Italian) |
| Tonnes per truck | 24 (22 to 27) | estimate | 6,000 t ÷ 260 trucks ≈ 23 t; 100 t ÷ 4 trucks = 25 t |
| Core sampling stations | 4 (3 to 5) | estimate | one arrival every 5.5 minutes at peak and an assumed 15 to 25 minute cycle |
| Minutes per sample | 20 | ask Mutti | no public data |
| Lab minutes | 30 | estimate | no public data |
| Rejected loads | 2% (1 to 3%) | ask Mutti | no public data |
| Unloading bays | 3 | estimate | not public |
| Minutes per unload | 15 (10 to 15) | estimate | 60 ÷ 8 trucks an hour = 7.5 minutes with one bay, 15 with two; bays not public. 3 bays at 15 minutes give 12 trucks an hour, enough for 260 trucks in 24 hours |
| Tanks | 5 of 100 t | real | plant visit video: 4 truckloads per tank |
| Line | 250 t/h | estimate | 6,000 t ÷ 24 hours |
| Tanks at start of day | 80% (0% at season start) | estimate | plant already running from the day before |
| Receiving | 24 hours a day | real | [Mutti press release 2022](https://mutti-parma.com/app/uploads/2022/10/cs--mutti-tomato-processing-season-results-2022-def-en-1.pdf) |

A historical figure from [Terra e Vita](https://terraevita.edagricole.it/fare-filiera/mutti-la-ferrari-del-pomodoro-premia/) (Italian) gives 8 trucks an hour unloaded at full capacity. At 8 trucks an hour you cannot unload 260 trucks in a day, so either the figure is old, or it applies to one bay, or unloading is faster at peak. It is one of the interview questions.

## Limits

- Three internal numbers are missing: core sampling time, waits at the gate and the share of rejected loads. Until we have them, the model shows mechanisms and orders of magnitude, not forecasts for the plant.
- Sampling, lab and unloading times are fixed. In reality they vary from truck to truck.
- The model does not track load quality (Brix, pH, colour) or blending in the tanks.
- The line runs at a constant rate, with no slow starts or format changes.
- The sources were read from search extracts and should be opened and checked before submission.

## The 3D scene

The model writes a log for every truck: arrival, station and start of sampling, lab result, bay, tank, and start and end of unloading. It also stores, minute by minute, the level of each tank, the tonnes processed and the state of the line. The scene replays this data: at every moment it works out where each truck should be and moves it there smoothly. It is not connected to real plant data. It is a twin of the model, ready to take real arrival times when they exist.

The layout is schematic. The areas (yard, gate, core sampling, lab result wait, unloading queue, bays, tanks, line) follow the order of the flow, not the real positions.

## Files

- `index.html`, `styles.css`: the page.
- `sim.js`: the model, with no dependencies, used by both the page and the tests.
- `layout.js`: the plant layout and where each truck is at a given minute, with no dependencies.
- `scene.js`: the 3D scene, built with Three.js.
- `app.js`: connects scenarios, parameters, timeline and panels to the model and the scene.
- `vendor/three/`: Three.js 0.169.0 with its licence, shipped with the site so it does not depend on a CDN.
- `tests/`: checks on the model (tonnes are conserved, every truck goes through the steps in order, stations and bays are never overloaded, results repeat) and on the scene (counts match the model's queues, no spot holds two trucks).

## Credits

- [Three.js](https://threejs.org) (MIT licence).
- Public Sans and JetBrains Mono fonts (SIL Open Font License), from Google Fonts.

## Licence

Code under the MIT licence, see `LICENSE`.
