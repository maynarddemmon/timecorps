# Authoring Time Corps Data

How to write the files in `data/` that make up the game: scenarios with their events and locations, agents, and the missions (operations) the player plays. Everything here is data. The engine reads it and does the rest, so a new scenario needs no code.

- [The files](#the-files)
- [Expressions](#expressions)
- [Stats](#stats)
- [init.json5](#initjson5)
- [Scenarios: locations and events](#scenarios-locations-and-events)
- [Values (causators)](#values-causators)
- [Scratch](#scratch)
- [Actions](#actions)
- [Exits](#exits)
- [Skill checks](#skill-checks)
- [Adjustments](#adjustments-adj)
- [Costs](#costs)
- [Default actions](#default-actions)
- [Agents](#agents)
- [Operations (missions)](#operations-missions)
- [Text and media](#text-and-media)
- [Checking your work](#checking-your-work)
- [Recipes](#recipes)

## The files

| File | Holds |
|---|---|
| `data/init.json5` | Loaded first: the list of scenario files, which mission the campaign starts with, skills, default skill checks, the special locations and events, and the actions every event offers |
| `data/<scenario>.json5` | One per scenario, e.g. `titanic_scenario.json5`: its locations, events and missions |
| `data/agents.json5` | The agents, and description phrases they all share |
| `data/help.txt`, `data/mission/`, `data/location/`, `data/dossiers/`, `data/event/` | Text shown in the game |
| `img/agent/`, `img/location/`, `img/mission/`, `img/event/` | Portraits and photos, plus optional videos |

The files load in this order: `init.json5`, the scenarios it lists, then `agents.json5`. A later file can refer to anything in an earlier one, and expressions can refer to anything at all, since they're only worked out once everything has loaded.

**Format.** The files are [JSON5](https://json5.org): JSON plus `//` and `/* */` comments and trailing commas. Keep keys quoted and strings in double quotes, so the files stay plain JSON apart from the comments (the data tests check this). Use comments to record *why* a number is what it is.

**IDs.** Events, locations, agents, operations, factions, prompts, scratch entries, values, actions, objectives and skills are all keyed by ID. IDs are what expressions and other data refer to, so make them short, stable and code-like: `lifeboat_capacity`, `fullDavits`, `VQ`. An ID must be letters, digits and `_`, not starting with a digit, since an expression names it with dots, e.g. `events.lifeboat_capacity.values.fullDavits`. Anything with another ID is skipped, with a warning, and data.spec checks them. Names are what the player sees.

## Expressions

Much of the data is JavaScript expressions in strings. There are two kinds.

### Constraint expressions

Used for anything that should stay up to date as the game changes: `hidden`, a value's `value`, an objective's `success`, `hideAffectedBy` entries, and the `hidden` of description phrases. The engine watches everything the expression reads and works it out again whenever any of it changes.

```json5
"hidden":"event.attestation.value < 15 || !events.collision.values.struck.value"
```

Anything that takes `hidden` also takes `shown`, its opposite, for when that reads more clearly. It's turned into the equivalent `hidden`, so it works the same way, including as a `true`/`false` and in a `set`, e.g. `"agents.AF.shown":{"onSuccess":"true"}`. Give one or the other, not both. Expressions can read either, e.g. `events.collision.shown` or `agents.AF.hidden`.

```json5
"shown":"events.collision.values.struck.value"   // the same as "hidden":"!(events.collision.values.struck.value)"
```

What an expression can refer to:

| Name | Is | Available in |
|---|---|---|
| `event` | The event the thing belongs to | Events and everything in them: values, actions, exits, phrases |
| `agent` | The agent | Agents and their description phrases |
| `operation` | The operation | Operations, their objectives and debrief |
| `events.<id>` | Any event | Everywhere |
| `agents.<id>` | Any agent | Everywhere |
| `operations.<id>` | Any operation | Everywhere |
| `factions.<id>` | Any [faction](#initjson5), e.g. `factions.timecorps.hq` | Everywhere |
| `timeline` | The overall game state, e.g. `timeline.paradox.value` | Everywhere |
| `timeline.cfg.<KEY>` | A game setting from `cfg` in `js/tc/tc.js`, e.g. `timeline.cfg.AGE_MIN_EFFECTIVE`. Read only | Everywhere |
| `scratch.<name>` | A [scratch](#scratch) entry | Everywhere |

Locations have none of the "self" names, so their phrases use `events.<id>` or `timeline`. Using a self name where it isn't available, e.g. `event` in an agent's expression, warns at load.

Useful things to read:

- A stat: `event.attestation.value`, `agents.VQ.paradox.max`. See [Stats](#stats).
- A value: `events.collision.values.struck.value`, or `event.values.struck.value` for the event's own.
- An agent's current event: `agent.event === 'the_void'`.
- An objective: `operations.titanic_noCollision.objectives.avoid.success`.
- How many times an action has been taken, or a value changed by one: `event.actions.recover.doneCount`, `event.values.relayToBridge.flipCount`.

Literal values are expressions too: `"true"`, `"false"`, `"0"`, and strings in single quotes, `"'Carpathia'"`.

Only property paths are watched. A method call such as `event.isHidden()` is worked out once but won't update, so read the property (`event.hidden`) instead.

### Check expressions

Used for skill checks (`check`), for adjustment amounts (`onSuccess`, `onFailure`, `onBoth`), for an action's `costs` and for its `available` condition. They're worked out when they're needed rather than watched, and can use:

| Name | Is |
|---|---|
| `agent` | The agent making the check. `agent.skills.<id>` is 0 for any skill the agent doesn't have |
| `event` | The event the agent is at |
| `timeline` | The overall game state |
| `timeline.cfg.<KEY>` | A game setting from `cfg` in `js/tc/tc.js`, e.g. `timeline.cfg.AGE_MIN_EFFECTIVE`. Read only |
| `scratch.<name>` | A [scratch](#scratch) entry |
| `events.<id>` | Any event, e.g. `events.collision.attestation.value` |
| `agents.<id>` | Any agent, e.g. `agents.ME.event`. Skills they don't have are 0, as for `agent` |
| `factions.<id>` | Any faction, e.g. `factions[agent.faction].hq` |
| `operations.<id>` | Any operation, e.g. `operations.spring_vote.successGranted` |
| `difficulty` | The check's difficulty |
| `d(sides, count)` | Rolls `count` dice (1 by default) of 1 to `sides` each and totals them, e.g. `d(6)`, `d(4, 2)`. Sides and count are rounded; sides is at least 1 and count is 1 to 99 |
| `margin` | Amounts only: how well the deciding check went. See [Adjustments](#adjustments-adj) |
| `chronal` | [Time travel hazards](#time-travel-hazards) only: the chronal the time travel cost. 0 anywhere else |

`Math` is available as usual, e.g. `Math.max(agent.skills.deception, agent.skills.disguise)`.

The result is taken as a number: `true` is 1 and `false` is 0. An expression that throws or doesn't give a finite number (say `agent.skils.stealth`, misspelled, which gives NaN) fails its check, or does nothing as an amount, with a warning in the console. One that doesn't compile, a syntax error, throws when it's first used and stops the game, so it can't ship: the data tests (see [Checking your work](#checking-your-work)) catch it first.

A check is the check expression minus the difficulty, so a comparison such as `agent.skills.stealth > 50` isn't caught: it's 1 or 0 minus the difficulty, which is a valid but nearly useless check. Write a check as an amount of skill, e.g. `agent.skills.stealth`.

An `available` condition gives a boolean (a number counts as true unless it's 0). It never rolls: a `d()` in it counts as its average. A broken condition is false, with a warning, so the action shows as unavailable rather than quietly allowed.

## Stats

Every stat has a value and a range, and changes stay within it.

| Stat | Range | Notes |
|---|---|---|
| `event.historicity` | 0–100 | How fixed the event is in history. Usually set by a mission's setup (`set`) |
| `event.attestation` | 0–100 | How much the Corps knows about the event. Raised by investigating. Knowing more reveals more |
| `event.paradox` | 0–`EVENT_PARADOX_LIMIT` (15) | Raised when agents revisit. Any change also changes `timeline.paradox`. Reaching the limit floods the event (see below) |
| `agent.health` | 0–`max`, max up to 150 | Default 100. 0 is death |
| `agent.chronal` | 0–100 | Spent to time travel. Default starting value 75 |
| `agent.paradox` | 0–`AGENT_PARADOX_LIMIT` (10) | Raised by revisiting an event. Reaching the limit devours the agent |
| `timeline.chronal` | 0–100 | HQ's reserve, used to reload agents. Starts at 25 |
| `timeline.paradox` | 0–limit | The limit is 20 plus 0.25 per known event that isn't a hub. Reaching it destabilizes the timeline |

Read them in expressions as `.value`, `.max` and `.min`. The limits are in `cfg` in `js/tc/tc.js`.

**Resisting paradox.** Revisiting an event owes a point of paradox for each earlier visit, and each point is kept, or resisted, by its own roll. The chance of keeping it runs from 95% down to 5%: lower the better the agent's `resistParadox` skill check (init.json5's `skillChecks`, e.g. `"resistParadox":{"name":"Resist Paradox", "check":"0.8*agent.skills.stealth + 0.1*agent.skills.chronogation + 0.1*agent.skills.luck"}`, taken from -1000 to 1000), and lower the fuller the agent's, the event's and the timeline's paradox already are. So it's easy to make a little paradox in many events, and hard to flood one. What's kept, and what's resisted, floats above the button that made the trip, e.g. "+1⥁ · 2⥁ resisted". The paradox shown on a button before the trip is what's owed, before any is resisted.

Any paradox reaching its limit counts, however it gets there: revisiting, an adjustment, a cost, a flood. Adjustments and costs are cut to what a stat allows, so they can reach a limit but never pass it.

**Flooding.** When an event's paradox reaches its limit, the event floods with paradox, once:

- No agent can time travel into or out of it: deploying, jumping, looping back and recalling are all refused. Its exits still work, both ways.
- No agent can take an action there that could generate paradox: one with an adjustment that raises an agent's, the event's or the timeline's paradox on average, if it passes or if it fails, or one that costs paradox. Its button is disabled, and its tooltip says why. Other actions, including ones that lower paradox, still work.
- Its box on the timeline turns the paradox color.
- Every agent who has ever been there gains a paradox for each visit, counted as for revisiting (their starting event counts). That can devour them.
- Every descendant event, known or not, gains a paradox, which can flood it in turn.

A flood's paradox doesn't cost score. Expressions can read `event.flooded`, e.g. for a description phrase.

The timeline also has a score and credits, read as plain numbers:

- **`timeline.score`**: the player's score. Missions award it (an `adj` of `timeline.score`), attestation adds 3 a point however it's gained or lost, and each point of paradox an agent gains by revisiting an event takes away 250.
- **`timeline.credits`**: what the Corps spends, e.g. on HQ actions' [costs](#costs). One credit is earned each time the score reaches a new multiple of `SCORE_TO_CREDITS_EARN_AMOUNT` (100) for the first time: a score of 78 earns none, and reaching 100 earns one. Losing score takes no credits away, and regaining it earns none until the score passes its highest yet. Missions can also award credits (an `adj` of `timeline.credits`). `set` and `adj` can change both score and credits, but never below 0.

## init.json5

```json5
{
	// The scenario files loaded after this one, in order.
	"scenarios":["titanic_scenario", "lusitania_scenario"],
	
	"factions":{
		"timecorps":{"label":"Time Corps", "hq":"time_corps_hq", "defaultAgentRole":"Agent", "description":"…"},
		"unaligned":{"label":"Unaligned", "description":"…"}
	},
	
	"skills":{
		"str":{"name":"Strength", "description":"Physical prowess and brawn."},
		…
	},
	
	"skillChecks":{
		"athletic":{"name":"Athletic", "check":"0.5*agent.skills.str + 0.5*agent.skills.agl", "difficulty":175},
		…
	},
	
	"agingSkillGains":{"monthsPerGain":1, "weights":{"luck":25, "investigation":9, …}},
	
	"exitModes":{"walk":"Walk to", "wait":"Wait til", …, "default":"To"},
	
	"timeTravelAdj":{
		"agent.health":{"actionType":"time_travel", "difficulty":300, "onFailure":"-d(chronal)"},
		…
	},
	
	"locations":{"_nexus":{…}, "_nowhere":{…}},
	"events":{"the_void":{…}, "time_corps_hq":{…}},
	"defaultEventActions":{"_investigate":{…}, "_rest":{…}}
}
```

- **`factions`**: the sides an agent can be on, by ID, with a `label` and a `description` (phrases, as for an event, shown as the Faction Brief's field notes), optionally a `defaultAgentRole`, the [role](#agents) of its agents who have none of their own, and optionally an `hq`, the ID of the event that's its HQ: only its agents can time travel there, they're recalled there, and they buy skills there. Every agent is in exactly one; `unaligned` must exist, since it's the default. The Agents grid and the dossier show an agent's faction, and clicking it opens the Faction Brief.
- **`legacy`**: what carries from one game to the next, the game's roguelike thread. Each of the player's agents lost in any game, devoured by chronovores or dead of their wounds, gives the `agent` named here skills at the start of every new game: `devoured` and `died` give amounts by skill, keyed as for [adjustments](#adjustments-adj), e.g. `"devoured":{"agent.skills.causalStability":3}`, kept within the skill range. The Event an agent was lost at (not a hub) is haunted from then on, in every game: one of the `hauntings` lines shows in italics under its description, the same one each time. It's kept in the browser apart from any save (`tc.legacy`), so starting over or importing a save keeps it. The ☠ button in the header shows what's accrued, and clears it; the game in progress keeps what it started with. Only the player's agents count, and only while playing, not as a save is restored. Without a `legacy`, none of it happens and there's no ☠ button. E.g. `"legacy":{"agent":"ME", "devoured":{"agent.skills.causalStability":3}, "died":{"agent.skills.luck":1}, "hauntings":["A spectral presence seems always just out of sight.", …]}`.
- **`skillTracks`**: what training a skill at HQ costs, by track, for an agent's affinity for it. Each track has a `label`, which the Agent Dossier shows beside a skill's name for any track but the default (one without shows its ID, with a warning), `minCredits`, the price of a point near 0 (default 1), and `pointsPerExtraCredit`, how far from 0 the skill goes, either way, for each credit more (default 100). Exactly one is marked `"default":true`, the track for any skill an agent's `skillsByTrack` leaves out. E.g. `"skillTracks":{"standard":{"label":"Standard", "default":true, "minCredits":1, "pointsPerExtraCredit":100}, "high":{"label":"Affinity", "minCredits":1, "pointsPerExtraCredit":200}}`. Without any, or with none marked the default, a point costs a credit, and one more for every 100 the skill is from 0. A later file's track replaces an earlier one with the same ID.
- **`exitModes`**: the phrase an [exit](#exits)'s button starts with, by its `mode`, before the name of where it goes, e.g. `"walk":"Walk to"` for "Walk to ❉ Time Corps Headquarters". `default` is for an exit with no mode, or one not listed; without it, the button is just the name. A new mode is just a new entry here. `jump` and `pulled` are time travel whatever their phrase, which the code decides. A later file's phrase replaces an earlier one for the same mode. The data tests flag an exit whose mode isn't listed.
- **`skills`**: every skill an agent can have, by ID, with a `name` and a `description` (the dossier's tooltip), and optionally `"trainable":false` for one that can't be bought at HQ, such as luck, which only grows with experience. The code names a few skills (`chronogation`, `investigation`, `stealth`, `disguise`, `deception`), so those must be here.
- **`skillChecks`**: named skill checks that actions refer to by `actionType`. Each has a `name` (shown in tooltips), a `check` (the skill part of the expression) and an optional `difficulty`. See [Skill checks](#skill-checks).
- **`the_void`** and **`time_corps_hq`** are special events, always hidden from the timeline. HQ is where agents start and reload. The Void is where devoured agents go. Their locations, `_nexus` and `_nowhere`, are never shown.
- **`defaultEventActions`**: see [Default actions](#default-actions).
- <a id="experience"></a>**`agingSkillGains`**: optional. Experience: for every `monthsPerGain` (default 1) of an agent's lived age, a skill picked by `weights`, whole numbers by skill ID, gains a point, within ±1000. Only the [lived age](#ages) counts: the effective age, which treatments and time travel change, never does. A gain floats above whatever caused it, e.g. "+1 Luck", just over the action's or exit's own result. Unknown skills and bad weights are warned about and left out. A later file's replaces an earlier one's.
- <a id="time-travel-hazards"></a>**`timeTravelAdj`**: optional. What can happen to an agent who pays chronal to deploy, be recalled or loop back. Exits never risk it, even `jump` and `pulled` ones, since they're the story's: give one its own `adj` instead, e.g. `"adj":{"agent.health":"-d(4)"}`. [Adjustments](#adjustments-adj), as for an action, keyed by what they change, e.g. `agent.health` or `agent.effectiveAge`. There's no action check to follow, so give each a check of its own, and amounts can use `chronal`, the chronal the time travel cost, e.g. `"-d(chronal)"`, or `"d(chronal)/12"` for that many months of aging. They're rolled as the agent leaves and applied once they arrive, so `event` is where they arrive. The time travel buttons show the health risk as ♥ and their tooltips describe each, and the result floats above the button, as for an action. A move the data makes, with `set` on `agent.event`, risks nothing. A later file's replaces an earlier one's.

Skills and skill checks can also be added by scenario files. A later file's entry replaces an earlier one with the same ID.

## Scenarios: locations and events

```json5
{
	// Added to every location's order in this file, to place the scenario's rows.
	"locationsBaseOrder":0,
	
	"locations":{
		"titanic_bridge":{
			"name":"Bridge",
			"color":"#ccf9",
			"textColor":"#000",   // Optional.
			"order":3,            // The row's position on the timeline, 0 or more. Required.
			"video":true,         // Optional: there's a .webm as well as the .jpg.
			"description":[…]     // Optional phrases, shown in the area brief.
		}
	},
	
	"events":{
		"collision":{…}
	}
}
```

Every location needs `img/location/<id>.jpg` and `data/location/<id>.txt`.

### Events

```json5
"collision":{
	"name":"The Collision",
	"start":"1912-04-14T23:40:00",   // UTC. A date alone is fine too: "1912-04-14". Or an offset from another event, see below.
	"duration":{"m":1},              // Any of "w", "d", "h", "m", "s", "ms".
	"location":"titanic_bridge",
	"actionLimit":2,                 // Optional. Actions an agent can take per visit.
	"hub":false,                     // Optional. See below.
	"chronoLocked":false,            // Optional. Or an expression. See below.
	"hidden":"…",                    // Optional. See below.
	"historicity":0,                 // Optional starting stats. Rarely needed.
	"attestation":0,
	"image":"../location/x.jpg",     // Optional. Shown instead of img/event/<id>.jpg. See Images.
	"brief":true,                    // Optional. There's data/event/<id>.txt for its Event Brief.
	"description":[…],
	"values":{…},
	"actions":{…},
	"exits":[…],
	"hideAffectedBy":{…}
}
```

- **`start` as an offset.** Instead of a date, `start` can be the start or end of another event plus an offset in the units `duration` takes, e.g. `{"endOf":"origin_alarm", "m":3}` or `{"startOf":"collision", "h":-1}`. It's worked out to a date as the event loads, so the event it names must be loaded before this one: earlier in the same file, or in a file `init` lists before it. Changing that event's start later, e.g. with `set`, doesn't move this one. A problem is warned about and the start falls back to 0, which halts startup like a bad date.
- **Time and place.** Two events at the same location can't overlap. An event must also start no earlier than the end of every event its values depend on. Both are checked at startup, which halts with a warning if either fails.
- **`actionLimit`.** Defaults to `DEFAULT_ACTION_LIMIT`, which `index.html` sets to 3.
- **`hub`.** A hub, such as HQ or The Void, is free of paradox: visiting it again costs none, and it doesn't raise the timeline's paradox limit. An agent can't loop back at a hub, and the selected agent's history arrows leave hubs out. Default: false.
- **`chronoLocked`.** No one can time travel into or out of a chrono locked event, e.g. The Void, which only being devoured gets an agent into, and never out of. Exits still lead there and away, e.g. a `jump` or `pulled` exit the story sets up. A boolean or a [constraint expression](#constraint-expressions), so play can lock and unlock it, e.g. `"!scratch.vault_open"`. Default: false.
- **`hidden`.** Leave it out for the usual rule: an event is hidden while nothing is known about it, meaning its attestation and historicity are both 0. It's also revealed once a *descendant* (an event whose values depend on it) reaches attestation 15, or a *precursor* (an event it depends on) reaches 25. Give your own expression to replace that rule, e.g. to reveal it only from one particular event.
- **`description`.** An array of phrases. A phrase is a string, or `{"text":…, "hidden":…}` to show it only sometimes, typically as attestation rises. Phrases are joined with spaces. HTML such as `<br>` works.

```json5
"description":[
	"At Berth 44 in Southampton, White Star reshuffles her senior officers.",
	{"text":"<br><br>Blair goes ashore with the key to the crow's nest locker.", "hidden":"event.attestation.value < 15"}
]
```

- **Event Brief.** Clicking the Event Details title, or double-clicking an event's box, opens its Event Brief, laid out like the Area Brief: its picture across the top (`img/event/<id>.jpg`, 512×208 like an area's, unless its `image` or `imageExpr` names another, see [Images](#images); the event's box in the timeline shows it too; add `"video":true` for a `.webm` too), then the location, time and stats as Event Details shows them, the visible description as field notes, and a report, if it has one (`"brief":true`: `data/event/<id>.txt`). Both are optional, and data.spec checks the files exist when flagged.
- <a id="brief-titles"></a>**Brief titles.** A brief's title is `"<title> : <name>"`. The `title` defaults to the event's location for an Event Brief, the agent's role for a dossier, "Area Brief" for a location and "Mission Brief" for a mission, and any of them can give its own `"title"`, e.g. `"title":"Breaking News"`.
- **`hideAffectedBy`.** Hides the timeline link from a precursor while an expression is true, e.g. so a connection isn't given away before it's discovered: `{"embassy_warning":"event.attestation.value < 25"}`.

## Values (causators)

Values are the facts of an event that the player can change, and that other events depend on. Together they make the causal graph the game is played on.

```json5
"values":{
	"preventReshuffle":{
		"name":"Reshuffle Prevented",
		"value":"false",               // A literal: set directly, or by actions.
		"description":[
			{"text":"Blair leaves the ship.", "hidden":"event.values.preventReshuffle.value"},
			{"text":"Blair stays aboard.",    "hidden":"!event.values.preventReshuffle.value"}
		]
	},
	"keyOnShip":{
		"name":"Locker Key Aboard",
		"value":"event.values.preventReshuffle.value || event.values.remindBlair.value",
		"description":[…]
	}
}
```

- **`value`** is a constraint expression. A literal like `"false"` is a starting point that actions can change. An expression is worked out from other values. A reference to another event's values (`events.<id>.values.<id>`) makes that event a precursor, which draws the link on the timeline and drives the default reveal rule.
- **`description`** gives the phrases for each state. Without one, the value itself is shown.
- **`hidden`** hides the value's row.
- **`flipCount`** counts how many times an action's `set` has changed the value, e.g. `event.values.relayToBridge.flipCount`. Setting it to what it already is doesn't count, and nor do changes that follow from other values. Any expression can read it, and constraints update when it changes.

## Scratch

Scratch entries are somewhere for the data to keep its own state, such as a count of how many times something has happened. Declare them, with their starting values, in a `"scratch"` at the top of any data file:

```json5
"scratch":{
	"wireless_clearBacklogEarlier_flipCount":0
}
```

- **One namespace.** Every entry is in the same scratch space, so start each name with the id of the event (or whatever) it belongs to. Names are identifiers: letters, digits and `_`.
- **Values** start, and stay, a number, a boolean or a string.
- **Declare before use.** A constraint can only follow an entry that's declared. Setting an undeclared entry is ignored, with a warning, and the data tests flag reading or setting one.
- **Read** `scratch.<name>` in any expression, e.g. `"hidden":"scratch.wireless_clearBacklogEarlier_flipCount >= 3"`. Constraints update as soon as an entry changes.
- **Set** them with an action's `set`. See [Actions](#actions).
- **Saved** with the rest of the game.

## Actions

Actions are what agents do at an event: a check, then changes to values and stats.

```json5
"actions":{
	"prevent":{
		"label":"Prevent Reshuffle",
		"skillCheck":{"actionType":"social"},
		"set":{"preventReshuffle":"true"},
		"hidden":"event.values.preventReshuffle.value",
		"adj":{
			"agent.chronal":{"onBoth":"-2"}
		}
	}
}
```

- **`label`**: the button's text.
- **`skillCheck`**: see [Skill checks](#skill-checks). Leave it out for an even chance: difficulty 250 against no skill.
- **`set`**: sets the event's own values, and [scratch](#scratch) entries. Keys are applied in order. Each entry is a string, set when the check passes, or `{"onSuccess":…, "onFailure":…}`, set for either result, or `{"onBoth":…}`, the same for both.
  - A string for a value's ID sets that value. The new value is a constraint expression, so `"true"` sets a literal and an expression makes the value follow it from then on.
  - A string for a `"scratch.<name>"` key sets that entry to what a [check expression](#check-expressions) works out to when the action is taken, once, so `"scratch.wireless_clearBacklogEarlier_flipCount":"scratch.wireless_clearBacklogEarlier_flipCount + 1"` counts. Dice roll, and a later key sees an earlier one. An action's adjustments are worked out before its sets, so they see the entries as they were.
  - `{"onSuccess":…, "onFailure":…}` gives each result its own check expression, either optional. It's worked out once, when the action is taken, and sees `margin` like an adjustment's amount, so a value is set to what it works out to, not kept up to date. E.g. `"set":{"bus":{"onSuccess":"'arrives'", "onFailure":"'late'"}}`, or `{"onSuccess":"margin"}` to keep how well it went. `{"onBoth":"'dove'"}` sets the same either way; `onSuccess` or `onFailure` beside `onBoth` is ignored, with a warning.
  - A stat or skill, keyed as for [adjustments](#adjustments-adj), e.g. `"agent.skills.agl":"50"` or `"agent.health":{"onFailure":"10"}`, is set to what its expression works out to, once, within the stat's limits. It's set by adjusting it, so its rules still apply: reaching a paradox limit devours, and `event.attestation` scores. Unlike adjustments, sets aren't shown in tooltips, flags or floating text, so use `adj` for changes the player should see.
  - Any other attribute of an agent or event that has a setter, e.g. `hidden`, `playerControlled` or `chronoLocked`, keyed `"agent.<attr>"`, `"agents.<id>.<attr>"`, `"event.<attr>"` or `"events.<id>.<attr>"`. As for a value, a string is a constraint expression kept up to date, and `{"onSuccess":…}` is worked out once, e.g. `"set":{"agents.AF.hidden":{"onSuccess":"false"}}` reveals AF on a pass. It replaces any expression the attribute had, and is saved. A key that names no attribute with a setter is ignored, with a warning at load, and these can't be adjusted.
  - Whether a [mission](#operations-missions) is hidden, keyed `"operations.<id>.hidden"` or `"operations.<id>.shown"`, e.g. `"set":{"operations.titanic_noCollision.hidden":"false"}` reveals it and offers its Mission Brief, as its own `hidden` becoming false would. It replaces that `hidden`, and a live expression is saved until it reveals the mission. Once revealed, a mission stays revealed, so a set changes nothing, e.g. for a job board checked again. Nothing else of a mission can be set.
- **`hidden`**: hides the button. The usual way to make an action one-time is to hide it once its value is set, with a twin action to undo it.
- **`available`**: a [check expression](#check-expressions) for whether a particular agent can take the action. When it's false the button is shown disabled for that agent, and the action can't be taken. `hidden` is the same for everyone at the event, so use `available` for anything about the agent, e.g. Rest's `"agent.health.value < agent.health.max"`. It's worked out whenever Event Details is redrawn, which happens when the event or one of its agents changes.
- **`group`**: the ID of an [action group](#action-groups) to show the action with, on a line of its own, e.g. HQ's Restock Chronal, which refills the shared pool rather than doing anything for the agent who takes it. Leave it out to show the action with the rest.
- **`adj`**: changes to stats. See [Adjustments](#adjustments-adj).
- **`costs`**: what the agent pays to take the action. One action unless it says otherwise. See [Costs](#costs).
- **`prompt`**: the ID of a [prompt](#prompts) to open when the check passes, after everything else the action does, or an array of IDs to open one after another.

Every action counts how many times it's been taken, pass or fail, as its `doneCount`, e.g. `event.actions.recover.doneCount`. Any expression can read it, and constraints update when it changes, so `"hidden":"event.actions.recover.doneCount >= 3"` allows three tries. An action's adjustments are worked out before its own `doneCount`, and the `flipCount` of the values it sets, go up, so they see the counts before this take.

Taking an action pays its costs, whether the check passes or fails. The button shows the check's ease ("even", "tough"…), any costs beyond the usual action and any adjustments in its tooltip. It's flagged (`[♥]`, `[⏲]`, `[⥁]`) when it could change health, chronal or paradox, by an adjustment or a cost.

Every event also offers the [default actions](#default-actions), Investigate and Rest, before its own.

### <a id="action-groups"></a>Action groups

Event Details shows each agent's actions at an event on a line led by the actions they have left. An action group gathers some of them onto a line of its own, led by the group's label, so actions that belong together, or that aren't really about the agent, stand apart. Groups can go in any data file, under `"actionGroups"`:

```json5
"actionGroups":{
	"hq_pool":{"label":"HQ Chronal Pool", "order":1}
}
```

- **`label`** leads the group's line.
- **`order`** places the line. The ungrouped actions are 0, so a negative order comes before them and a positive one after. Groups go in order among themselves. An order of 0 is warned about, and puts the group right after the ungrouped actions.
- A group's line only shows when the agent can see at least one of its actions. An action whose `group` names no group is warned about at startup and shown with the ungrouped actions.

## Exits

Exits are ways to leave an event for another without time travel, so they cost no chronal.

```json5
"exits":[
	{"mode":"walk", "to":"casualties"},
	{"mode":"wait", "to":"arrival_new_york", "hidden":"event.values.struck.value"},
	{
		"mode":"lifeboat",
		"to":"arrival_new_york",
		"hidden":"!events.collision.values.struck.value",
		"adj":{"agent.health":{"difficulty":500, "check":"agent.skills.str", "onFailure":"-150", "onSuccess":"-d(4,2)"}}
	}
]
```

- **`mode`**: how the exit is taken, one of init.json5's [`exitModes`](#initjson5), which gives the phrase its button starts with, e.g. `walk` for "Walk to", `take` for "Take", which suits an event named for a route, e.g. "Take The Long Way Home", or `loopback` for "Loop back to". `jump` and `pulled` are time travel. Without one, it's the `default` phrase, "To".
- **`to`**: the event it leads to. An exit to a hidden event isn't offered, unless it's `toHidden`.
- **`toHidden`**: `true` to offer the exit even while the event it leads to is hidden. The button names the event, but it stays off the timeline until it's revealed, so the player can choose one of several hidden places and only the one they choose appears. Reveal it with the exit's `set`, e.g. by raising its attestation, which reveals an event without a `hidden` of its own, or by changing what its own `hidden` reads:
  
  ```json5
  "exits":[{"mode":"bike", "to":"origin_hospital", "toHidden":true, "set":{"events.origin_hospital.attestation":"1"}}]
  ```
- **`allowLoopback`**: `true` to let the exit lead back into its own event (`"to"` is the event's own ID), starting it over: the agent lives through the rest of it, as for any exit, then arrives again with all its actions back. It's a revisit, so it costs paradox like any other, except at a hub. Use it to let an agent stay longer at HQ, e.g. `{"mode":"loopback", "to":"time_corps_hq", "allowLoopback":true}`. Without it, an exit back into its own event isn't offered.
- **`hidden`**: hides the exit.
- **`adj`**: as for actions. Taking an exit always succeeds, so an adjustment without its own check uses `onSuccess`. Give it a check of its own for an exit that can go wrong.
- **`set`**: as for actions, applied as a success when the exit is taken, before the agent arrives.
- **`costs`**: as for actions, but an exit costs nothing unless it says so, e.g. `"costs":{"agent.chronal":"1"}`. The button is disabled while the agent can't pay, and its tooltip lists the costs.
- **`prompt`**: the ID of a [prompt](#prompts) to open as the exit is taken, or an array of IDs to open one after another. The agent arrives once the last is answered.

## Skill checks

A check rolls 0 to 999 and adds its *ease*, `check - difficulty`. It passes at 0 or more. So against difficulty 500 with no skill, it passes on 500 or more: half the time. Each skill point is 0.1%.

```json5
"skillCheck":{"actionType":"sneak", "difficulty":300}
```

Each part is optional, and comes from the first of these that gives it:

1. The action's own `skillCheck`: `difficulty`, `check`, `actionType`.
2. The named check in `skillChecks` that `actionType` names.
3. If `actionType` names a skill instead, that skill alone: `"actionType":"cha"` checks `agent.skills.cha`.
4. The defaults: difficulty 250, check `0`.

- **The name shown in tooltips** is the named check's `name`, or the skill's name, or nothing.
- **Never certain.** The ease is limited to −999…−1, so any rolled check has at least a 0.1% chance either way.
- **No roll.** For a certain result, use `"difficulty":"no-roll"`: the check always passes without rolling, as `sure_thing` does.

## Adjustments (`adj`)

Adjustments change stats as the result of an action or exit. They go in its `adj`, and add to what they change, where an action's [`set`](#actions) replaces it. They're keyed by the stat they change, as `"<scope>.<stat>"`:

| Scope | Stats | Whose |
|---|---|---|
| `agent` | `health`, `chronal`, `paradox`, `effectiveAge` | The agent taking the action or exit. `effectiveAge` is in years; see [Ages](#ages) |
| `event` | `attestation`, `historicity`, `paradox` | The event the action or exit belongs to |
| `timeline` | `paradox`, `chronal`, `score`, `credits` | The timeline. Score and credits can't go below 0 |
| `events.<id>` | `attestation`, `historicity`, `paradox` | Any event, by its ID, e.g. `"events.collision.historicity"` |
| `agents.<id>` | `health`, `chronal`, `paradox`, `effectiveAge` | Any agent, by their ID, e.g. `"agents.ME.chronal"` |

A key can also name a Value of any event, as `"events.<id>.values.<value>"`, e.g. `"events.aftermath.values.lost"`, or a skill of any agent, as `"agents.<id>.skills.<skill>"`, e.g. `"agents.ME.skills.chronogation"`. So an action can change another event, and an exit can change the event it leads to, e.g. `"adj":{"events.aftermath.attestation":"5"}`. A `set` (not an `adj`) can also move an agent to an event, keyed `"agent.event"` for the agent taking the action, or `"agents.<id>.event"` for any agent. Its expression is worked out once to an event ID, so a fixed one needs quotes: `"set":{"agents.BA.event":"'lgv_announcement'"}`. The move is a deploy (from HQ) or a jump, with all its rules: the chronal is paid and any paradox for a revisit is gained, and if the agent can't go, e.g. for want of chronal, they stay put, with a warning. Use it in a mission's `onSetup` to put agents where the mission starts. A `set` can also put an agent in a faction, keyed `"agent.faction"` or `"agents.<id>.faction"`, with the faction's ID in quotes, e.g. `"set":{"agents.ME.faction":"'timecorps'"}`.

These name the event or agent by ID, so they work in a mission's `set` and `adj` too. An adjustment to another event or agent shows in tooltips by its name, e.g. "Aftermath Attestation" or "You Chronogation".

An adjustment can also change one of the agent's skills, keyed `"agent.skills.<skill>"`, e.g. `"agent.skills.agl"`. Skills change within ±`MAX_SKILL_VALUE` (1000), are named in tooltips and floating text by the skill's name, e.g. "+15 Agility", and are saved with the agent. Origin Story uses them to build the player's agent from their choices.

An adjustment can also add to a Value of its event, keyed by the Value's ID, e.g. `"count":{"onSuccess":"1"}`, or to a scratch entry, e.g. `"scratch.origin_knocks":{"onSuccess":"1"}`. Only a number can be added to; anything else is left alone, with a warning. The Value is set to the new number, not kept up to date. These aren't shown to the player in tooltips, flags or floating text.

```json5
"adj":{
	// A hard climb: hurts a little on a pass and a lot on a failure.
	"agent.health":{"difficulty":250, "actionType":"athletic", "onSuccess":"-d(4)", "onFailure":"-d(6, 5)"},
	// What's found, the more the better the action went.
	"event.attestation":{"onSuccess":"1 + Math.floor(margin / 200)"},
}
```

Each adjustment has:

- **`onSuccess`** and **`onFailure`**: amount expressions. At least one is needed. Positive raises the stat and negative lowers it, within its range. Amounts are rounded to whole points, except for `effectiveAge`, which takes fractions of a year.
- **`onBoth`**: instead of `onSuccess` and `onFailure`, one amount for either result. Either of them beside it is ignored, with a warning.
- **A string alone** is short for `{"onSuccess":…}`, so it applies only on a pass, like a string `set`: `"adj":{"agent.skills.agl":"1"}`.
- **A check of its own** (optional): any of `difficulty`, `check` and `actionType`, as for an action. With one, the adjustment rolls it and picks `onSuccess` or `onFailure` by the result. Without one, it follows the action's own check.
- **`enabledForActionSkillCheck`** (actions only): `"success"`, `"failure"` or `"both"`, the default. Whether the adjustment applies at all, depending on the action's own check. Useful when an adjustment has its own check but should only happen after the action fails, say.

**`margin`** is how well the deciding check went: its roll plus its ease. It's 0 or more on a pass and negative on a failure. A bare pass is about 0, and a roll at the top can be close to 1000. The deciding check is the adjustment's own check if it has one, or else the action's. It's 0 when nothing was rolled: an exit without its own check, or a no-roll check. That makes margin-based amounts pointless behind a no-roll check, so give those a fixed or dice amount instead.

**How adjustments show:**

- The tooltip lists each adjustment's average amounts, e.g. "Event Attestation: ~+5 if passed". Health harm reads as injury, e.g. "♥ Risking: serious injury (light injury if passed)".
- The floating text after taking the action or exit shows each change, e.g. "Succeeded by 140 · +4 Attestation · −3♥".

**Side effects worth knowing:**

- Raising or lowering `event.attestation` changes the score by 3 per point, the same as investigating.
- Any change to `event.paradox` also changes `timeline.paradox`. `agent.paradox` changes only the agent.

## Costs

Costs are what an agent pays to take an action or an exit. An action costs one of the agent's actions at the event unless it says otherwise; an exit costs nothing unless it says otherwise. Costs are keyed by what's paid, and each is an amount [check expression](#check-expressions):

```json5
// Two actions, and 100 score, more for each point of the event's paradox.
"costs":{
	"agent.action":"2",
	"timeline.score":"100 + 100 * event.paradox.value"
}
```

| Key | Pays | Payable while |
|---|---|---|
| `agent.action` | The agent's actions at the event | It has that many left |
| `agent.health` | The agent's health | It keeps at least 1 |
| `agent.chronal` | The agent's chronal | It has that much |
| `agent.paradox` | Adds to the agent's paradox | That stays below its limit |
| `event.attestation`, `event.historicity` | The event's stat | It has that much |
| `event.paradox` | Adds to the event's paradox | That stays below its limit |
| `timeline.chronal` | HQ's chronal | It has that much |
| `timeline.paradox` | Adds to the timeline's paradox | That stays below its limit |
| `timeline.score` | The player's score | The score is at least that |
| `timeline.credits` | The Corps' credits | There are at least that many |

- **Merged over the default.** Costs are merged over the default of one action, so `{"timeline.score":"100"}` costs an action and 100 score. To change the action cost, give `agent.action`, e.g. `"0"`. `null` leaves a cost out, so `{"agent.action":null}` is an action that uses no action, and `"costs":null` leaves them all out.
- **Worked out when needed.** Amounts are worked out when the button is drawn and again when the action is taken, from the state at that moment, so `"agent.paradox.value"` costs as many actions as the agent has paradox. They never roll: a `d()` counts as its average. They're rounded to whole points.
- **All or nothing.** The action can only be taken if every cost can be paid. Otherwise its button is disabled, and its tooltip marks the cost that can't be paid.
- **Paid first.** Costs are worked out and checked before the action's check rolls, and paid whatever the result. Adjustments are worked out from the state before the costs are paid, then applied after them.
- **Not gains.** A negative amount is a gain, which is what [adjustments](#adjustments-adj) are for, so it pays nothing, with a warning. A broken amount can't be paid, with a warning, so the action shows as unavailable.
- **Side effects.** As for adjustments: paying `event.attestation` lowers the score by 3 a point, and adding to `event.paradox` adds to `timeline.paradox` too.

The tooltip lists costs, e.g. "Costs: 2 Actions, 100 Score", leaving out the usual single action, and says "Uses no action" for an action that doesn't use one.

## Default actions

`defaultEventActions` in `init.json5` are actions every event offers, before its own. They're ordinary actions: Investigate is `_investigate` (a check with an `event.attestation` adjustment) and Rest is `_rest` (a check with an `agent.health` adjustment).

An event changes one by giving an action with the same ID. It's merged over the default key by key, so it only needs what differs. Use `null` to leave a default out, or one of its adjustments:

```json5
"actions":{
	// A harder investigation here, otherwise the same.
	"_investigate":{"skillCheck":{"difficulty":150}},
	
	// No time to rest.
	"_rest":null
}
```

```json5
// Rest even at full health, by leaving out the default's condition.
"_rest":{"available":null}
```

```json5
// A no-roll investigation has no margin, so it gets its own amount.
"_investigate":{
	"skillCheck":{"difficulty":"no-roll"},
	"adj":{"event.attestation":{"onSuccess":"d(Math.min(25, event.attestation.max - event.attestation.value))"}}
}
```

HQ and The Void leave out `_investigate` this way.

## Agents

```json5
{
	// Phrases every agent's description ends with.
	"agentDefaults":{
		"description":[
			{"text":"Clean record.", "hidden":"agent.paradox.value !== 0"},
			…
		]
	},
	
	"agents":{
		"VQ":{
			"name":"Vasquez",
			"nameExpr":"scratch.vasquez_alias",  // Optional. Replaces the name. See below.
			"role":"Pilot",                     // Optional. Default: the faction's defaultAgentRole.
			"roleExpr":"…",                     // Optional. Replaces the role, as nameExpr does the name.
			"born":"2139-05-14",                // Required. For the record.
			"age":34,                           // Optional, in years. Default: 30. See Ages below.
			"effectiveAge":31,                  // Optional. Default: their age.
			"faction":"timecorps",              // Optional. Default: "unaligned".
			"event":"collision",                // Where they start. Default: their faction's HQ.
			"health":{"value":65, "max":85},   // Or just a number for the value. Default: 100 of 100.
			"chronal":75,                       // Default 75.
			"paradox":0,
			"skills":{"investigation":100, "str":50, …},  // Any skill left out is 0.
			"skillsByTrack":{"high":["chronogation", "persuasion"], "low":["str", "cha"]},  // Optional. See Skills below.
			"randomSkillsByTrack":{"high":3, "low":3},  // Optional. Picked for each new game. See Skills below.
			"video":true,                       // There's a .webm portrait as well as the .jpg.
			"hidden":"events.lifeboat_capacity.attestation.value < 5",  // Optional. See below.
			"playerControlled":true,            // Optional. See below.
			"description":[…]                   // Optional, before the shared phrases.
		}
	}
}
```

- **Hidden and player control.** Agents start hidden and not under the player's control. A mission reveals them (`revealAgents`) and puts them under the player's control (`awardAgents`). An agent can instead reveal itself with a `hidden` expression, e.g. once an event is known about. A revealed agent who isn't player controlled is a civilian.
- **`role`** shows in the Agents grid and the dossier. `roleExpr` overrides it while it works out to a non-empty string, and without either, the agent's faction's `defaultAgentRole` is used, so it follows a change of faction.
- **`nameExpr`.** A [constraint expression](#constraint-expressions) for the agent's name. While it works out to a non-empty string, trimmed, that's the name. Otherwise `name` is. The Origin Story's `avatar_name` prompt sets `scratch.avatar_name`, which You's `nameExpr` reads.
- **Files.** Every agent needs `img/agent/<id>.jpg` (or another `image`, see [Images](#images)) and `data/dossiers/<id>.txt`. Revealing an agent shows their dossier, titled with their role unless they have a `title` (see [Brief titles](#brief-titles)).
- <a id="ages"></a>**Ages**, in years, read as `agent.age` and `agent.effectiveAge`. The lived age starts as the data's `age` (30 if it's left out). It grows by the time the agent lives through:
  - **An action** lives through the event's duration divided by its `actionLimit`, for each action it costs, so spending every action lives through all of it. A free action (`"agent.action":null`) takes no time. In an event whose `actionLimit` is 0, the whole duration is lived through on arrival. HQ counts too: it's a month of 30 actions, a day each, so a week-long treatment costs 7.
  - **An exit** lives through the rest of the event left, e.g. its unused actions, then the time from its end to the start of the one arrived at, unless its `mode` is `jump` or `pulled`, which are time travel and skip the time between.
  - **Time travel** (deploy, jump, recall, loop back) lives through nothing, not even the rest of the event left.
  
  The effective age is the body's. It grows with the lived age, and treatments wind it back: `set` or `adj` on `agent.effectiveAge`, in years, e.g. `"adj":{"agent.effectiveAge":"-10"}`. Unlike every other stat it isn't rounded to whole points, so `"d(6)/12"` ages by up to half a year, and tooltips and floating text show it to 2 decimal places, though never below 28 (`AGE_MIN_EFFECTIVE`). From an effective age of 35 the agent's maximum health declines, slowly at first and then faster, to 0, and death, at 85. The `health` max in the data is the agent's in their prime. The thresholds and curve are `AGE_*` in `js/tc/tc.js`. The Agent Dossier shows both ages.
- **Skills** run from -1000 to `MAX_SKILL_VALUE` (1000). The player can raise a player-controlled agent's skills while they're at HQ, from the buttons in their dossier, a point at a time. Each point takes an action (a day at HQ, which ages the agent) and costs credits by the skill's track for that agent: the track's `minCredits`, plus one for every `pointsPerExtraCredit` the skill is from 0, either way. On a track of 1 and 100, 99 to 100 costs 1, and 100 to 101 costs 2. An agent's `skillsByTrack` puts skills on tracks by the IDs of init.json5's [`skillTracks`](#initjson5), and any skill it leaves out is on the default track. A track or skill that doesn't exist is ignored, with a warning, and a skill on two tracks is on the later one. `randomSkillsByTrack` instead gives how many skills to put on each track at random, e.g. `{"high":3, "low":3}` for the player's own agent. They're picked as each new game starts, from the trainable skills `skillsByTrack` leaves out, and saved with the game. The price is set by `getSkillPurchase` in `js/tc/model/AgentModel.js`.

## Operations (missions)

Each scenario file holds its own missions, under `operations`. The mission the campaign starts with is `initialOperation`, given in `init.json5` (a later file's replaces it).

```json5
{
	"operations":{
		"titanic_noCollision":{
			"name":"Titanic - Avoid the Iceberg",
			"image":true,                      // There's img/mission/<id>.jpg. Optional for missions.
			"description":[…],                 // The brief's field notes. Phrases, as for events.
			// Optional. Reveals the mission when it's false, e.g. once another is completed.
			"hidden":"!operations.titanic_intro.successGranted",
			"onSetup":{
				"revealAgents":"VQ",           // An ID or an array of them.
				"awardAgents":"VQ",
				"initialAgentSelection":"VQ",
				"initialEventSelection":"collision",
				// Optional. As for an action, but keyed by event ID, e.g. each event's historicity.
				"set":{"events.collision.historicity":"75", "events.casualties.historicity":"65"},
				"adj":{"timeline.credits":"20"}, // Optional. Credits to start the mission with.
				"prompt":"welcome"               // Optional. Opens after the brief.
			},
			"objectives":{
				"avoid":{
					"name":"No Collision",
					"description":["The Titanic must not hit the iceberg."],
					"success":"!events.collision.values.struck.value"
				}
			},
			"onSuccess":{
				"debrief":[…],                 // Phrases, shown when the mission is completed.
				"nextOperation":"titanic_rescued",
				// The rewards: score, HQ chronal, and credits on top of those the score earns.
				"adj":{"timeline.score":"5000", "timeline.chronal":"15", "timeline.credits":"10"},
				"revealAgents":["GO", "PI"],
				"awardAgents":["GO"],
				"prompt":"recruit"             // Optional. Opens before Mission Complete.
			}
		}
	}
}
```

- **Revealing.** A mission is hidden until it's revealed: as `initialOperation`, as another's `nextOperation` when that one is completed, or by its `hidden`, a [constraint expression](#constraint-expressions), becoming false, including by a `set`, e.g. `"set":{"operations.titanic_noCollision.hidden":"false"}` from an action. `operations.<id>.successGranted` is true once that mission is completed, so completing one can reveal several. Once revealed, a mission stays revealed. The Missions tab lists the revealed missions: `available`, `active`, `current` (the one selected, whose objectives the timeline marks) or `completed`.
- **Starting.** A revealed mission is `available` until the player starts it, so several can be under way at once. `initialOperation` starts by itself. A mission revealed by its `hidden` opens its Mission Brief with **Accept Mission**, and the debrief's **Next Mission** opens the next one's the same way. Closing the brief leaves the mission available, and selecting it in the Missions tab shows **Start Mission** in the Mission panel. Starting a mission makes it current.
- **Setup.** When a mission is started, its setup is applied once: its `adj` and `set`, the Mission Brief opened (unless it was accepted from the brief), and agents revealed and awarded. Its selection is made whenever it becomes the current mission, once it's started.
- **Completion.** A started mission is complete when every objective's `success` is true, whether or not it's the current one. An available mission's objectives show their progress, but it can't complete until it's started. Then its `adj` and `set` are applied and agents revealed and awarded, once, and the debrief is shown, with phrases that can describe how it was won.
- **`set` and `adj`.** As for an [action](#actions), applied as a success: adjustments first, then sets. A mission has no agent or event of its own, so its keys name events and agents by ID (`events.<id>.<stat>`, `events.<id>.values.<value>`, `agents.<id>.<stat>`, `agents.<id>.skills.<skill>`), the timeline or scratch, and its expressions are [check expressions](#check-expressions) without an `agent` or `event`, so they can use `timeline`, `scratch` and dice. `onFailure` is never used. The old `historicityAdjustments`, `awardScore`, `awardCredits` and `awardHQChronal` are ignored, with a warning.
- **`prompt`.** The ID of a [prompt](#prompts), or an array of IDs to open one after another, e.g. `["avatar_name", "avatar_image"]`. onSetup's open after the Mission Brief and the dossiers of the agents it reveals. onSuccess's open as the mission completes, and Mission Complete, with its save, waits for the last answer.
- **`promptEarly`.** The ID of a prompt, or an array of them, that opens before the agents are revealed and awarded, so before their dossiers: onSetup's right after the Mission Brief, onSuccess's before onSuccess's `prompt`. Use it for something a dossier should already reflect, e.g. asking for the player's name. A mission can have both.
- **Entanglements.** Each objective lists the events its `success` reads, as buttons that select them: a Causator shows as `Collision: Struck`, a stat as `Collision: Attestation`. Events and Causators the player hasn't discovered show as "Unknown" until they're revealed. Reading a property, as everywhere else, is what counts, so `!events.collision.values.struck.value` lists Struck but a method call doesn't.
- **The campaign.** `nextOperation` links the missions together. The last mission has none. It's a mission's ID, or a [check expression](#check-expressions) that works out to one when the mission is completed, so how it was won can decide what comes next, e.g. `"agents.ME.faction === 'timecorps' ? 'titanic_noCollision' : 'syndicate_offer'"`. `null` or `''` leads nowhere, as for a mission with none, e.g. when the next one is offered some other way. It's worked out once, after the success `prompt` is answered, and the mission it names is revealed then, whether or not the player goes on to it from the debrief.
- **Brief text.** Every mission needs `data/mission/<id>.txt`, the briefing shown in its Mission Brief.

## Prompts

A prompt is a message the player answers with a button, e.g. an offer to join the Time Corps. Actions, exits and missions open one by its ID with `"prompt"` (missions also with `"promptEarly"`). Prompts can go in any data file, under `"prompts"`.

```json5
"prompts":{
	"avatar_name":{
		"type":"text",
		"title":"Yesterday’s Mail",
		"description":["A few bills and some credit card offers, all made out to you:"],
		"input":{"scratch":"avatar_name", "maxLength":20, "allowedChars":"abc…XYZ -'.", "placeholder":"Your name"},
		"buttons":{"confirm":{"label":"That’s Me"}}
	},
	"recruit":{
		"type":"confirm",
		"title":"An Offer",
		"description":["Beniko holds out her hand. “The Corps could use you.”"],
		"hidden":"agents.ME.faction === 'timecorps'",
		"buttons":{
			"confirm":{"label":"Join", "onClick":{"set":{"agents.ME.faction":"'timecorps'"}}},
			"cancel":{"label":"Not Yet"}
		}
	}
}
```

- **`type`**: `ack`, one button, `confirm`, two, `text`, a text field and one button, or `image`, images to step through and one button. Default: `ack`.
- **`title`**: the dialog's title.
- **`description`**: the message. Phrases, as for an event.
- **`hidden`**: a constraint expression. A hidden prompt doesn't open.
- **`input`**: for a `text` prompt, required: `scratch`, the [scratch](#scratch) entry the text goes in, and optionally `maxLength`, `allowedChars`, a string of the characters that can be typed, and `placeholder`, shown while the field is empty. The field starts with the entry's value. Confirm can't be clicked while it's blank, and the text is trimmed and put in the entry before its `onClick`. A `text` prompt without a usable `input` is shown as an `ack`.
  For an `image` prompt, required: `scratch`, the entry the chosen image goes in, and `images`, an array of paths to images from `img/`, e.g. `["avatar/AA.jpg", "avatar/AB.jpg"]`. The player steps through them with the arrow buttons or keys, wrapping around at either end, each shown whole in a square. It starts on the entry's value if that's one of them, or the first, and the one showing when Confirm is clicked is put in the entry, as listed, before its `onClick`. To use it as a picture, give an `imageExpr` that reads the entry from the model's own folder, e.g. You's `"'../' + scratch.avatar_photo"`. data.spec checks each image exists and that the entry starts as one of them. An `image` prompt without a usable `input` is shown as an `ack`.
- **`buttons`**: by ID: `confirm` for any type, and `cancel` for a `confirm`. Each has an optional `label`, which replaces the dialog's own, and an optional `onClick` with `set` and `adj`, applied as for a [mission's](#operations-missions): as a success, naming agents and events by ID. `cancel` also applies when the dialog is closed another way.

A prompt waits its turn behind other dialogs, as mission briefs do. Whether it's hidden is decided when its turn comes, and its text when it opens. Prompts given as an array take their turns one after another, all ahead of anything opened after them, e.g. the dossiers of the agents a mission reveals, and an earlier prompt's answer can hide a later one. An exit's arrival and a mission's Mission Complete wait for the answer, so the save made on completion has it. A prompt isn't saved, so one open when the page is reloaded is lost.

## Text and media

| Path | For |
|---|---|
| `data/help.txt` | The Field Manual, shown on the first visit |
| `data/mission/<operation>.txt` | A mission's briefing |
| `data/location/<location>.txt` | A location's area brief |
| `data/dossiers/<agent>.txt` | An agent's dossier |
| `data/event/<event>.txt` | An event's brief report, if it has `"brief":true` |
| `img/agent/<agent>.jpg` (and `.webm`) | Portrait, with an optional video version |
| `img/location/<location>.jpg` (and `.webm`) | Location photo, with an optional video version |
| `img/mission/<operation>.jpg` | A mission's picture, if it has `"image":true` |
| `img/event/<event>.jpg` | An event's picture (512×208, like an area's) |

A `.jpg` is required even when there's a video, since it's the fallback. Text files can contain HTML.

### <a id="images"></a>Images

Every event, location and agent shows `img/<folder>/<id>.jpg`, where the folder is `event`, `location` or `agent`. A mission shows `img/mission/<id>.jpg` only with `"image":true`, since a mission's picture is optional. Two keys change which picture is shown:

- **`image`**: a path to another `.jpg`, from the model's own folder, e.g. `"image":"../location/origin_street.jpg"` to reuse a location's photo for an event.
- **`imageExpr`**: a [constraint expression](#constraint-expressions) for such a path, so the picture can follow the game. While it works out to a non-empty string, that's shown. Otherwise `image`, or the default, is. Every view showing the picture updates as it changes, including an open brief, e.g. `"imageExpr":"event.values.struck.value ? 'collision_struck.jpg' : ''"`.

A video (`"video":true`) is always `<id>.webm` and plays instead of the picture where videos are shown, whatever `imageExpr` says. data.spec checks that every event's picture exists (by default, or its `image`), except at The Nexus and Nowhere. It can't check what an `imageExpr` shows, so a model with one needn't have the picture it would show without it, e.g. You has no `img/agent/ME.jpg`. Give it that file anyway if its expression can work out to `''`.

## Checking your work

- **At startup** the game checks that events at the same location don't overlap, and that every event starts no earlier than the end of the events it depends on. Problems with a config, like an unknown key or a bad difficulty, are warned about in the browser console, naming the event and action.
- **`npm test`** includes `tests/data.spec.mjs`, which checks the data without playing. It looks for:
  - references to events, agents, operations and locations that don't exist;
  - configs that aren't valid;
  - expressions that don't compile;
  - missing image and text files;
  - JSON5 beyond comments and trailing commas.
  
  Run just it with `npx playwright test data`.
- **The other tests don't use these files.** They play with their own data in `tests/data/`, so changing a scenario never breaks them.

## Recipes

**A one-time action, with a way to undo it.** Hide each action according to the value it sets.

```json5
"plant":{"label":"Plant Key", "skillCheck":{"actionType":"sneak"}, "set":{"plantKey":"true"},  "hidden":"event.values.plantKey.value"},
"unplant":{"label":"Remove Key", "skillCheck":{"actionType":"sneak"}, "set":{"plantKey":"false"}, "hidden":"!event.values.plantKey.value"}
```

**Something that costs more each time it's changed back.** Read the value's `flipCount`. Adjustments see the count before this change, so the first change is free.

```json5
"set":{"relayToBridge":"true"},
"adj":{"agent.paradox":{"onSuccess":"event.values.relayToBridge.flipCount >= 1 ? 1 : 0"}}
```

**An action that costs more after the first try.** The same with its `doneCount`, which counts failures too, so the adjustment needs both cases, which `onBoth` gives it.

```json5
"adj":{"agent.paradox":{"onBoth":"event.actions.recover.doneCount >= 1 ? 1 : 0"}}
```

**Counting something else.** Keep the count in a [scratch](#scratch) entry and add to it in a `set`, e.g. `"scratch.wireless_clearBacklogEarlier_flipCount":"scratch.wireless_clearBacklogEarlier_flipCount + 1"`.

**A value with several ways to make it true.** Join the ways in its expression. Each event it reads becomes a precursor.

```json5
"binocularsAccessible":{"name":"Glasses in the Nest", "value":"events.roster_reshuffle.values.keyOnShip.value || event.values.pickTheLocker.value"}
```

**An action that's risky to try.** Give it an `agent.health` adjustment with its own check, so even a successful action can hurt.

```json5
"adj":{"agent.health":{"difficulty":250, "actionType":"athletic", "onFailure":"-d(6,5)", "onSuccess":"-d(4)"}}
```

**Risk only when the action fails.**

```json5
"adj":{"agent.health":{"enabledForActionSkillCheck":"failure", "actionType":"athletic", "onFailure":"-5"}}
```

**An action that costs more than an action.** Costs are merged over the default action.

```json5
"costs":{"timeline.credits":"25"}   // An action and 25 credits.
```

**An action that uses no action.** Leave out the default.

```json5
"costs":{"agent.action":null}
```

**An action that costs chronal and leaves a mark.** A cost is paid either way, and only if the agent has it. Adjustments without a check follow the action.

```json5
"costs":{"agent.chronal":"3"},
"adj":{"event.paradox":{"onSuccess":"1"}}   // A crude fix leaves a mark.
```

**Evidence that rewards a good result.**

```json5
"adj":{"event.attestation":{"onSuccess":"1 + Math.floor(margin / 100)"}}
```

**An exit that's only there sometimes.**

```json5
{"mode":"wait", "to":"arrival_new_york", "hidden":"event.values.struck.value"}
```

**An event revealed only by one particular event.** Give it a `hidden` of its own instead of the default rule.

```json5
"hidden":"event.attestation.value === 0 && event.historicity.value === 0 && events.casualties.attestation.value < 25"
```

**An agent revealed by discovery rather than a mission.**

```json5
"hidden":"events.lifeboat_capacity.attestation.value < 5"
```

**A mission that needs several things at once.** Give it one objective per thing. The mission completes when all of them are met.
