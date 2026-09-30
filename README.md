# Time Corps

A single-player puzzle game about repairing history. You direct the Time Corps, a team of agents sent into the past to investigate historical events and change the facts that decide how they turn out, without unravelling the timeline in the process.

**▶ Play it here: [maynarddemmon.github.io/timecorps](https://maynarddemmon.github.io/timecorps/)**

The game runs in a desktop browser and is best played in a wide window. It's a work in progress, and progress isn't saved between sessions yet.

## How it plays

History is modelled as a directed graph of events. Each event has **causators**: the facts that decide what happens there. Some can be set directly by an agent's actions; others are derived from causators earlier in the chain. Change one, and the effect ripples forward through every event that depends on it.

- **Missions** give you objectives, such as keeping the Titanic off the iceberg or getting her passengers into the boats.
- **Agents** deploy from HQ and jump between events, spending chronal energy, or walk and wait their way along the timeline.
- **Investigating** an event raises its attestation. The more the Corps knows, the more of the event's account, its hidden connections and its possible actions are revealed.
- **Paradox** builds up whenever an agent enters an event they have already visited. Too much, and the timeline comes apart.

Each event, location and causator is described in text that changes with the state of the timeline, so the history you read is the history you've made.

The current campaign covers the Titanic (1912) and the Lusitania (1915). The in-game **?** button opens the full field manual.

## Running locally

There's no build step, but the game loads its data with `fetch`, so it has to be served over HTTP rather than opened as a file. From the project root:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Linting and tests

The linter and tests need Node.js. Install the dev dependencies once, plus the browser the tests drive:

```
npm install
npx playwright install chromium
```

Then:

```
npm run lint    # ESLint over the game code and the tests
npm test        # Playwright tests in a headless browser
```

The tests start their own static server, load the real `index.html`, and check that:

- the game starts with no errors or warnings, and the scenario data passes its startup validation;
- every constraint reference in the data resolves, and every location and agent has its image and text;
- the whole campaign can be played through, with each mission completing and advancing;
- the constraint scopes, Field Notes and causator links behave as intended.

Requests to other sites are stubbed out, so the tests don't need a network connection. `npx playwright test --headed` shows the browser while they run, and `npx playwright test campaign` runs a single file.

## Project layout

| Path | Contents |
|---|---|
| `index.html` | Entry point, global styles and fonts |
| `js/tc/` | Game code: `model/` (events, agents, locations, operations, constraints), `view/` (panels and dialogs), `component/` (shared UI) |
| `lib/` | The myt JavaScript framework the game is built on |
| `data/*.json` | Scenarios, agents and operations |
| `data/location/`, `data/dossiers/` | Area briefs and agent dossiers |
| `data/help.txt` | The in-game field manual |
| `img/` | Agent portraits and location photographs |
| `fonts/` | Fonts and their licenses |
| `tests/` | Playwright tests (`npm test`) |

### Scenario data

Scenarios are plain JSON. Visibility, causator values and description phrases can all be written as constraint expressions that are re-evaluated as the timeline changes, for example:

```json
"hidden":"event.attestation.value < 15 || !events.collision.values.struck.value"
```

Expressions can refer to `event` (the event being described), `events.<id>` (any event) and `timeline` (the overall game state). The data is checked at startup: every precursor must end before its dependent begins, and no two events at the same location may overlap.

## License & Credits

- Fonts: [Advent Pro](https://github.com/googlefonts/Advent) and Space Mono (SIL Open Font License), and Rock Salt (Apache License 2.0). See `fonts/` for the license texts.
- Photographs generated with Midjourney.

MIT. See [LICENSE](LICENSE).
