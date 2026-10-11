# Authoring Time Corps Data

How to write the files in `data/` that make up the game: scenarios with their events and locations, agents, and the missions (operations) the player plays. Everything here is data. The engine reads it and does the rest, so a new scenario needs no code.

- [The files](#the-files)
- [Expressions](#expressions)
- [Stats](#stats)
- [init.json5](#initjson5)
- [Scenarios: locations and events](#scenarios-locations-and-events)
- [Values (causators)](#values-causators)
- [Actions](#actions)
- [Exits](#exits)
- [Skill checks](#skill-checks)
- [Effects](#effects)
- [Default actions](#default-actions)
- [Agents](#agents)
- [Operations (missions)](#operations-missions)
- [Text and media](#text-and-media)
- [Checking your work](#checking-your-work)
- [Recipes](#recipes)

## The files

| File | Holds |
|---|---|
| `data/init.json5` | Loaded first: the list of scenario files, skills, default skill checks, the special locations and events, and the actions every event offers |
| `data/<scenario>.json5` | One per scenario, e.g. `titanic_scenario.json5`: its locations and events |
| `data/agents.json5` | The agents, and description phrases they all share |
| `data/operations.json5` | The missions, and which one the campaign starts with |
| `data/help.txt`, `data/mission/`, `data/location/`, `data/dossiers/` | Text shown in the game |
| `img/agent/`, `img/location/`, `img/mission/` | Portraits and photos, plus optional videos |

The files load in this order: `init.json5`, the scenarios it lists, `agents.json5`, `operations.json5`. A later file can refer to anything in an earlier one, and expressions can refer to anything at all, since they're only worked out once everything has loaded.

**Format.** The files are [JSON5](https://json5.org): JSON plus `//` and `/* */` comments and trailing commas. Keep keys quoted and strings in double quotes, so the files stay plain JSON apart from the comments (the data tests check this). Use comments to record *why* a number is what it is.

**IDs.** Events, locations, agents, operations, values, actions and objectives are all keyed by ID. IDs are what expressions and other data refer to, so make them short, stable and code-like: `lifeboat_capacity`, `fullDavits`, `VQ`. Names are what the player sees.

## Expressions

Much of the data is JavaScript expressions in strings. There are two kinds.

### Constraint expressions

Used for anything that should stay up to date as the game changes: `hidden`, a value's `value`, an objective's `success`, `hideAffectedBy` entries, and the `hidden` of description phrases. The engine watches everything the expression reads and works it out again whenever any of it changes.

```json5
"hidden":"event.attestation.value < 15 || !events.collision.values.struck.value"
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
| `timeline` | The overall game state, e.g. `timeline.paradox.value` | Everywhere |

Locations have none of the "self" names, so their phrases use `events.<id>` or `timeline`. Using a self name where it isn't available, e.g. `event` in an agent's expression, warns at load.

Useful things to read:

- A stat: `event.attestation.value`, `agents.VQ.paradox.max`. See [Stats](#stats).
- A value: `events.collision.values.struck.value`, or `event.values.struck.value` for the event's own.
- An agent's current event: `agent.event === 'the_void'`.
- An objective: `operations.titanic_noCollision.objectives.avoid.success`.

Literal values are expressions too: `"true"`, `"false"`, `"0"`, and strings in single quotes, `"'Carpathia'"`.

Only property paths are watched. A method call such as `event.isHidden()` is worked out once but won't update, so read the property (`event.hidden`) instead.

### Check expressions

Used for skill checks (`check`) and for effect amounts (`onSuccess`, `onFailure`). They're worked out once, when the check happens, and can use:

| Name | Is |
|---|---|
| `agent` | The agent making the check. `agent.skills.<id>` is 0 for any skill the agent doesn't have |
| `event` | The event the agent is at |
| `timeline` | The overall game state |
| `difficulty` | The check's difficulty |
| `d(sides, count)` | Rolls `count` dice (1 by default) of 1 to `sides` each and totals them, e.g. `d(6)`, `d(4, 2)`. Sides and count are rounded; sides is at least 1 and count is 1 to 99 |
| `margin` | Amounts only: how well the deciding check went. See [Effects](#effects) |

`Math` is available as usual, e.g. `Math.max(agent.skills.deception, agent.skills.disguise)`.

An expression that doesn't compile, throws or doesn't give a number fails its check, or does nothing as an amount, with a warning in the console.

## Stats

Every stat has a value and a range, and changes stay within it.

| Stat | Range | Notes |
|---|---|---|
| `event.historicity` | 0–100 | How fixed the event is in history. Raised by mission setup (`historicityAdjustments`) |
| `event.attestation` | 0–100 | How much the Corps knows about the event. Raised by investigating. Knowing more reveals more |
| `event.paradox` | 0–`EVENT_PARADOX_LIMIT` (4) | Raised when agents revisit. Any change also changes `timeline.paradox`. At the limit the event devours the agents in it |
| `agent.health` | 0–`max`, max up to 150 | Default 100. 0 is death |
| `agent.chronal` | 0–100 | Spent to time travel. Default starting value 75 |
| `agent.paradox` | 0–`AGENT_PARADOX_LIMIT` (3) | Raised by revisiting an event. Past the limit the agent is devoured |
| `timeline.chronal` | 0–100 | HQ's reserve, used to reload agents. Starts at 25 |
| `timeline.paradox` | 0–limit | The limit is 9 plus 0.25 per known regular event. Past it the timeline destabilizes |

Read them in expressions as `.value`, `.max` and `.min`. The limits are in `cfg` in `js/tc/tc.js`.

## init.json5

```json5
{
	// The scenario files loaded after this one, in order.
	"scenarios":["titanic_scenario", "lusitania_scenario"],
	
	"skills":{
		"str":{"name":"Strength", "description":"Physical prowess and brawn."},
		…
	},
	
	"skillChecks":{
		"athletic":{"name":"Athletic", "check":"0.5*agent.skills.str + 0.5*agent.skills.agl", "difficulty":175},
		…
	},
	
	"locations":{"_nexus":{…}, "_nowhere":{…}},
	"events":{"the_void":{…}, "time_corps_hq":{…}},
	"defaultEventActions":{"_investigate":{…}, "_rest":{…}}
}
```

- **`skills`**: every skill an agent can have, by ID, with a `name` and a `description` (the dossier's tooltip). The code names a few skills (`chronogation`, `investigation`, `stealth`, `disguise`, `deception`), so those must be here.
- **`skillChecks`**: named skill checks that actions refer to by `actionType`. Each has a `name` (shown in tooltips), a `check` (the skill part of the expression) and an optional `difficulty`. See [Skill checks](#skill-checks).
- **`the_void`** and **`time_corps_hq`** are special events, always hidden from the timeline. HQ is where agents start and reload. The Void is where devoured agents go. Their locations, `_nexus` and `_nowhere`, are never shown.
- **`defaultEventActions`**: see [Default actions](#default-actions).

Skills and skill checks can also be added by scenario files. A later file's entry replaces an earlier one with the same ID.

## Scenarios: locations and events

```json5
{
	// Added to every location's order in this file, to place the scenario's rows.
	"locationsBaseOrder":0,
	
	"locations":{
		"titanic.bridge":{
			"name":"Bridge",
			"color":"#ccf9",
			"textColor":"#000",   // Optional.
			"order":3,            // The row's position on the timeline. Required.
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
	"start":"1912-04-14T23:40:00",   // UTC. A date alone is fine too: "1912-04-14".
	"duration":{"m":1},              // Any of "w", "d", "h", "m", "s", "ms".
	"location":"titanic.bridge",
	"actionLimit":2,                 // Optional. Actions an agent can take per visit.
	"hidden":"…",                    // Optional. See below.
	"historicity":0,                 // Optional starting stats. Rarely needed.
	"attestation":0,
	"description":[…],
	"values":{…},
	"actions":{…},
	"exits":[…],
	"hideAffectedBy":{…}
}
```

- **Time and place.** Two events at the same location can't overlap. An event must also start no earlier than the end of every event its values depend on. Both are checked at startup, which halts with a warning if either fails.
- **`actionLimit`.** Defaults to `DEFAULT_ACTION_LIMIT`, which `index.html` sets to 3.
- **`hidden`.** Leave it out for the usual rule: an event is hidden while nothing is known about it, meaning its attestation and historicity are both 0. It's also revealed once a *descendant* (an event whose values depend on it) reaches attestation 15, or a *precursor* (an event it depends on) reaches 25. Give your own expression to replace that rule, e.g. to reveal it only from one particular event.
- **`description`.** An array of phrases. A phrase is a string, or `{"text":…, "hidden":…}` to show it only sometimes, typically as attestation rises. Phrases are joined with spaces. HTML such as `<br>` works.

```json5
"description":[
	"At Berth 44 in Southampton, White Star reshuffles her senior officers.",
	{"text":"<br><br>Blair goes ashore with the key to the crow's nest locker.", "hidden":"event.attestation.value < 15"}
]
```

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

## Actions

Actions are what agents do at an event: a check, then changes to values and stats.

```json5
"actions":{
	"prevent":{
		"label":"Prevent Reshuffle",
		"skillCheck":{"actionType":"social"},
		"set":{"preventReshuffle":"true"},
		"hidden":"event.values.preventReshuffle.value",
		"effects":{
			"agent.chronal":{"onSuccess":"-2", "onFailure":"-2"}
		}
	}
}
```

- **`label`**: the button's text.
- **`skillCheck`**: see [Skill checks](#skill-checks). Leave it out for an even chance: difficulty 250 against no skill.
- **`set`**: on success, sets the event's own values. Each new value is a constraint expression, so `"true"` sets a literal and an expression makes the value follow it from then on.
- **`hidden`**: hides the button. The usual way to make an action one-time is to hide it once its value is set, with a twin action to undo it.
- **`effects`**: changes to stats. See [Effects](#effects).

Taking an action uses one of the agent's actions at the event, whether the check passes or fails. The button shows the check's ease ("even", "tough"…) and any effects in its tooltip. It's flagged (`[♥]`, `[⏲]`, `[⥁]`) when it could change health, chronal or paradox.

Every event also offers the [default actions](#default-actions), Investigate and Rest, before its own.

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
		"effects":{"agent.health":{"difficulty":500, "check":"agent.skills.str", "onFailure":"-150", "onSuccess":"-d(4,2)"}}
	}
]
```

- **`mode`**: `wait`, `walk`, `swim` or `lifeboat`, which give "Wait til", "Walk to", "Swim to" and "Lifeboat to". Anything else gives "To".
- **`to`**: the event it leads to. An exit to a hidden event isn't offered.
- **`hidden`**: hides the exit.
- **`effects`**: as for actions. Taking an exit always succeeds, so an effect without its own check uses `onSuccess`. Give it a check of its own for an exit that can go wrong.

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

## Effects

Effects change stats as the result of an action or exit. They're keyed by the stat they change, as `"<scope>.<stat>"`:

| Scope | Stats | Whose |
|---|---|---|
| `agent` | `health`, `chronal`, `paradox` | The agent taking the action or exit |
| `event` | `attestation`, `historicity`, `paradox` | The event the action or exit belongs to |
| `timeline` | `paradox`, `chronal` | The timeline |

```json5
"effects":{
	// A hard climb: hurts a little on a pass and a lot on a failure.
	"agent.health":{"difficulty":250, "actionType":"athletic", "onSuccess":"-d(4)", "onFailure":"-d(6, 5)"},
	// What's found, the more the better the action went.
	"event.attestation":{"onSuccess":"1 + Math.floor(margin / 200)"},
}
```

Each effect has:

- **`onSuccess`** and **`onFailure`**: amount expressions. At least one is needed. Positive raises the stat and negative lowers it, within its range. Amounts are rounded to whole points.
- **A check of its own** (optional): any of `difficulty`, `check` and `actionType`, as for an action. With one, the effect rolls it and picks `onSuccess` or `onFailure` by the result. Without one, it follows the action's own check.
- **`enabledForActionSkillCheck`** (actions only): `"success"`, `"failure"` or `"both"`, the default. Whether the effect applies at all, depending on the action's own check. Useful when an effect has its own check but should only happen after the action fails, say.

**`margin`** is how well the deciding check went: its roll plus its ease. It's 0 or more on a pass and negative on a failure. A bare pass is about 0, and a roll at the top can be close to 1000. The deciding check is the effect's own check if it has one, or else the action's. It's 0 when nothing was rolled: an exit without its own check, or a no-roll check. That makes margin-based amounts pointless behind a no-roll check, so give those a fixed or dice amount instead.

**How effects show:**

- The tooltip lists each effect's average amounts, e.g. "Event Attestation: ~+5 if passed". Health harm reads as injury, e.g. "♥ Risking: serious injury (light injury if passed)".
- The floating text after taking the action or exit shows each change, e.g. "Succeeded by 140 · +4 Attestation · −3♥".

**Side effects worth knowing:**

- Raising or lowering `event.attestation` changes the score by 3 per point, the same as investigating.
- Any change to `event.paradox` also changes `timeline.paradox`. `agent.paradox` changes only the agent.

## Default actions

`defaultEventActions` in `init.json5` are actions every event offers, before its own. They're ordinary actions: Investigate is `_investigate` (a check with an `event.attestation` effect) and Rest is `_rest` (a check with an `agent.health` effect).

An event changes one by giving an action with the same ID. It's merged over the default key by key, so it only needs what differs. Use `null` to leave a default out, or one of its effects:

```json5
"actions":{
	// A harder investigation here, otherwise the same.
	"_investigate":{"skillCheck":{"difficulty":150}},
	
	// No time to rest.
	"_rest":null
}
```

```json5
// A no-roll investigation has no margin, so it gets its own amount.
"_investigate":{
	"skillCheck":{"difficulty":"no-roll"},
	"effects":{"event.attestation":{"onSuccess":"d(Math.min(25, event.attestation.max - event.attestation.value))"}}
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
			"event":"collision",                // Where they start. Default: HQ.
			"health":{"value":65, "max":85},   // Or just a number for the value. Default: 100 of 100.
			"chronal":75,                       // Default 75.
			"paradox":0,
			"skills":{"investigation":100, "str":50, …},  // Any skill left out is 0.
			"video":true,                       // There's a .webm portrait as well as the .jpg.
			"hidden":"events.lifeboat_capacity.attestation.value < 5",  // Optional. See below.
			"playerControlled":true,            // Optional. See below.
			"description":[…]                   // Optional, before the shared phrases.
		}
	}
}
```

- **Hidden and player control.** Agents start hidden and not under the player's control. A mission reveals them (`revealAgents`) and puts them under the player's control (`awardAgents`). An agent can instead reveal itself with a `hidden` expression, e.g. once an event is known about. A revealed agent who isn't player controlled is a civilian.
- **Files.** Every agent needs `img/agent/<id>.jpg` and `data/dossiers/<id>.txt`. Revealing an agent shows their dossier.

## Operations (missions)

```json5
{
	"initialOperation":"titanic_noCollision",
	
	"operations":{
		"titanic_noCollision":{
			"name":"Titanic - Avoid the Iceberg",
			"image":true,                      // There's img/mission/<id>.jpg. Optional for missions.
			"description":[…],                 // The brief's field notes. Phrases, as for events.
			"onSetup":{
				"revealAgents":"VQ",           // An ID or an array of them.
				"awardAgents":"VQ",
				"initialAgentSelection":"VQ",
				"initialEventSelection":"collision",
				// Raises each event's historicity to at least this.
				"historicityAdjustments":{"collision":75, "casualties":65}
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
				"awardScore":5000,
				"awardHQChronal":15,           // Added to timeline.chronal.
				"revealAgents":["GO", "PI"],
				"awardAgents":["GO"]
			}
		}
	}
}
```

- **Setup.** When a mission starts, its setup is applied once: historicity raised, the Mission Brief opened, agents revealed and awarded, and the selection made.
- **Completion.** A mission is complete when every objective's `success` is true. Then its rewards are granted once, and the debrief is shown, with phrases that can describe how it was won.
- **The campaign.** `nextOperation` links the missions together. The last mission has none.
- **Brief text.** Every mission needs `data/mission/<id>.txt`, the briefing shown in its Mission Brief.

## Text and media

| Path | For |
|---|---|
| `data/help.txt` | The Field Manual, shown on the first visit |
| `data/mission/<operation>.txt` | A mission's briefing |
| `data/location/<location>.txt` | A location's area brief |
| `data/dossiers/<agent>.txt` | An agent's dossier |
| `img/agent/<agent>.jpg` (and `.webm`) | Portrait, with an optional video version |
| `img/location/<location>.jpg` (and `.webm`) | Location photo, with an optional video version |
| `img/mission/<operation>.jpg` | A mission's picture, if it has `"image":true` |

A `.jpg` is required even when there's a video, since it's the fallback. Text files can contain HTML.

## Checking your work

- **At startup** the game checks that events at the same location don't overlap, and that every event starts no earlier than the end of the events it depends on. Problems with a config, like an unknown key, a bad difficulty or an expression that doesn't compile, are warned about in the browser console, naming the event and action.
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

**A value with several ways to make it true.** Join the ways in its expression. Each event it reads becomes a precursor.

```json5
"binocularsAccessible":{"name":"Glasses in the Nest", "value":"events.roster_reshuffle.values.keyOnShip.value || event.values.pickTheLocker.value"}
```

**An action that's risky to try.** Give it an `agent.health` effect with its own check, so even a successful action can hurt.

```json5
"effects":{"agent.health":{"difficulty":250, "actionType":"athletic", "onFailure":"-d(6,5)", "onSuccess":"-d(4)"}}
```

**Risk only when the action fails.**

```json5
"effects":{"agent.health":{"enabledForActionSkillCheck":"failure", "actionType":"athletic", "onFailure":"-5"}}
```

**An action that also costs or causes something.** Effects without a check follow the action.

```json5
"effects":{
	"agent.chronal":{"onSuccess":"-3", "onFailure":"-3"},   // Costs chronal either way.
	"event.paradox":{"onSuccess":"1"}                        // A crude fix leaves a mark.
}
```

**Evidence that rewards a good result.**

```json5
"effects":{"event.attestation":{"onSuccess":"1 + Math.floor(margin / 100)"}}
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
