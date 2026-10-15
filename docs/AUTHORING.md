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
- [Effects](#effects)
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

Used for skill checks (`check`), for effect amounts (`onSuccess`, `onFailure`), for an action's `costs` and for its `available` condition. They're worked out when they're needed rather than watched, and can use:

| Name | Is |
|---|---|
| `agent` | The agent making the check. `agent.skills.<id>` is 0 for any skill the agent doesn't have |
| `event` | The event the agent is at |
| `timeline` | The overall game state |
| `scratch.<name>` | A [scratch](#scratch) entry |
| `difficulty` | The check's difficulty |
| `d(sides, count)` | Rolls `count` dice (1 by default) of 1 to `sides` each and totals them, e.g. `d(6)`, `d(4, 2)`. Sides and count are rounded; sides is at least 1 and count is 1 to 99 |
| `margin` | Amounts only: how well the deciding check went. See [Effects](#effects) |

`Math` is available as usual, e.g. `Math.max(agent.skills.deception, agent.skills.disguise)`.

The result is taken as a number: `true` is 1 and `false` is 0. An expression that doesn't compile, throws or doesn't give a finite number (say `agent.skils.stealth`, misspelled, which gives NaN) fails its check, or does nothing as an amount, with a warning in the console.

A check is the check expression minus the difficulty, so a comparison such as `agent.skills.stealth > 50` isn't caught: it's 1 or 0 minus the difficulty, which is a valid but nearly useless check. Write a check as an amount of skill, e.g. `agent.skills.stealth`.

An `available` condition gives a boolean (a number counts as true unless it's 0). It never rolls: a `d()` in it counts as its average. A broken condition is false, with a warning, so the action shows as unavailable rather than quietly allowed.

## Stats

Every stat has a value and a range, and changes stay within it.

| Stat | Range | Notes |
|---|---|---|
| `event.historicity` | 0–100 | How fixed the event is in history. Raised by mission setup (`historicityAdjustments`) |
| `event.attestation` | 0–100 | How much the Corps knows about the event. Raised by investigating. Knowing more reveals more |
| `event.paradox` | 0–`EVENT_PARADOX_LIMIT` (6) | Raised when agents revisit. Any change also changes `timeline.paradox`. Reaching the limit floods the event (see below) |
| `agent.health` | 0–`max`, max up to 150 | Default 100. 0 is death |
| `agent.chronal` | 0–100 | Spent to time travel. Default starting value 75 |
| `agent.paradox` | 0–`AGENT_PARADOX_LIMIT` (5) | Raised by revisiting an event. Reaching the limit devours the agent |
| `timeline.chronal` | 0–100 | HQ's reserve, used to reload agents. Starts at 25 |
| `timeline.paradox` | 0–limit | The limit is 9 plus 0.25 per known regular event. Reaching it destabilizes the timeline |

Read them in expressions as `.value`, `.max` and `.min`. The limits are in `cfg` in `js/tc/tc.js`.

Any paradox reaching its limit counts, however it gets there: revisiting, an effect, a cost, a flood. Effects and costs are cut to what a stat allows, so they can reach a limit but never pass it.

**Flooding.** When an event's paradox reaches its limit, the event floods with paradox, once:

- No agent can time travel into or out of it: deploying, jumping, looping back and recalling are all refused. Its exits still work, both ways.
- No agent can take an action there that could generate paradox: one with an effect that raises an agent's, the event's or the timeline's paradox on average, if it passes or if it fails, or one that costs paradox. Its button is disabled, and its tooltip says why. Other actions, including ones that lower paradox, still work.
- Its box on the timeline turns the paradox color.
- Every agent who has ever been there gains a paradox for each visit, counted as for revisiting (their starting event counts). That can devour them.
- Every descendant event, known or not, gains a paradox, which can flood it in turn.

A flood's paradox doesn't cost score. Expressions can read `event.flooded`, e.g. for a description phrase.

The timeline also has a score and credits, read as plain numbers:

- **`timeline.score`**: the player's score. Missions award it (`awardScore`), attestation adds 3 a point, and each point of paradox an agent gains by revisiting an event takes away 500.
- **`timeline.credits`**: what the Corps spends, e.g. on HQ actions' [costs](#costs). One credit is earned each time the score reaches a new multiple of `SCORE_TO_CREDITS_EARN_AMOUNT` (100) for the first time: a score of 78 earns none, and reaching 100 earns one. Losing score takes no credits away, and regaining it earns none until the score passes its highest yet. Missions can also award credits (`awardCredits`).

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
		"effects":{
			"agent.chronal":{"onSuccess":"-2", "onFailure":"-2"}
		}
	}
}
```

- **`label`**: the button's text.
- **`skillCheck`**: see [Skill checks](#skill-checks). Leave it out for an even chance: difficulty 250 against no skill.
- **`set`**: on success, sets the event's own values, and [scratch](#scratch) entries. Keys are applied in order.
  - A key that's a value's ID sets that value. The new value is a constraint expression, so `"true"` sets a literal and an expression makes the value follow it from then on.
  - A `"scratch.<name>"` key sets that entry to what a [check expression](#check-expressions) works out to when the action is taken, once, so `"scratch.wireless_clearBacklogEarlier_flipCount":"scratch.wireless_clearBacklogEarlier_flipCount + 1"` counts. Dice roll, and a later key sees an earlier one. An action's effects are worked out before its sets, so they see the entries as they were.
- **`hidden`**: hides the button. The usual way to make an action one-time is to hide it once its value is set, with a twin action to undo it.
- **`available`**: a [check expression](#check-expressions) for whether a particular agent can take the action. When it's false the button is shown disabled for that agent, and the action can't be taken. `hidden` is the same for everyone at the event, so use `available` for anything about the agent, e.g. Rest's `"agent.health.value < agent.health.max"`. It's worked out whenever Event Details is redrawn, which happens when the event or one of its agents changes.
- **`effects`**: changes to stats. See [Effects](#effects).
- **`costs`**: what the agent pays to take the action. One action unless it says otherwise. See [Costs](#costs).

Every action counts how many times it's been taken, pass or fail, as its `doneCount`, e.g. `event.actions.recover.doneCount`. Any expression can read it, and constraints update when it changes, so `"hidden":"event.actions.recover.doneCount >= 3"` allows three tries. An action's effects are worked out before its own `doneCount`, and the `flipCount` of the values it sets, go up, so they see the counts before this take.

Taking an action pays its costs, whether the check passes or fails. The button shows the check's ease ("even", "tough"…), any costs beyond the usual action and any effects in its tooltip. It's flagged (`[♥]`, `[⏲]`, `[⥁]`) when it could change health, chronal or paradox, by an effect or a cost.

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
- **`costs`**: as for actions, but an exit costs nothing unless it says so, e.g. `"costs":{"agent.chronal":"1"}`. The button is disabled while the agent can't pay, and its tooltip lists the costs.

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

An effect can also change one of the agent's skills, keyed `"agent.skills.<skill>"`, e.g. `"agent.skills.agl"`. Skills change within ±`MAX_SKILL_VALUE` (1000), are named in tooltips and floating text by the skill's name, e.g. "+15 Agility", and are saved with the agent. Origin Story uses them to build the player's agent from their choices.

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
- **Paid first.** Costs are worked out and checked before the action's check rolls, and paid whatever the result. Effects are worked out from the state before the costs are paid, then applied after them.
- **Not gains.** A negative amount is a gain, which is what [effects](#effects) are for, so it pays nothing, with a warning. A broken amount can't be paid, with a warning, so the action shows as unavailable.
- **Side effects.** As for effects: paying `event.attestation` lowers the score by 3 a point, and adding to `event.paradox` adds to `timeline.paradox` too.

The tooltip lists costs, e.g. "Costs: 2 Actions, 100 Score", leaving out the usual single action, and says "Uses no action" for an action that doesn't use one.

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
// Rest even at full health, by leaving out the default's condition.
"_rest":{"available":null}
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
- **Skills** run from -1000 to `MAX_SKILL_VALUE` (1000). The player can raise a player-controlled agent's skills while they're at HQ, from the buttons in their dossier, for 1 credit a point. The price is set by `getSkillPurchase` in `js/tc/model/AgentModel.js`.

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
				"awardCredits":20,             // Optional. Credits to start the mission with.
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
				"awardCredits":10,             // Optional. On top of those the score earns.
				"revealAgents":["GO", "PI"],
				"awardAgents":["GO"]
			}
		}
	}
}
```

- **Setup.** When a mission starts, its setup is applied once: historicity raised, the Mission Brief opened, agents revealed and awarded, credits awarded, and the selection made.
- **Completion.** A mission is complete when every objective's `success` is true. Then its rewards (score, chronal, credits and agents) are granted once, and the debrief is shown, with phrases that can describe how it was won.
- **Entanglements.** Each objective lists the events its `success` reads, as buttons that select them: a Causator shows as `Collision: Struck`, a stat as `Collision: Attestation`. Events and Causators the player hasn't discovered show as "Unknown" until they're revealed. Reading a property, as everywhere else, is what counts, so `!events.collision.values.struck.value` lists Struck but a method call doesn't.
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

**Something that costs more each time it's changed back.** Read the value's `flipCount`. Effects see the count before this change, so the first change is free.

```json5
"set":{"relayToBridge":"true"},
"effects":{"agent.paradox":{"onSuccess":"event.values.relayToBridge.flipCount >= 1 ? 1 : 0"}}
```

**An action that costs more after the first try.** The same with its `doneCount`, which counts failures too, so the effect needs both cases.

```json5
"effects":{"agent.paradox":{
	"onSuccess":"event.actions.recover.doneCount >= 1 ? 1 : 0",
	"onFailure":"event.actions.recover.doneCount >= 1 ? 1 : 0"
}}
```

**Counting something else.** Keep the count in a [scratch](#scratch) entry and add to it in a `set`, e.g. `"scratch.wireless_clearBacklogEarlier_flipCount":"scratch.wireless_clearBacklogEarlier_flipCount + 1"`.

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

**An action that costs more than an action.** Costs are merged over the default action.

```json5
"costs":{"timeline.credits":"25"}   // An action and 25 credits.
```

**An action that uses no action.** Leave out the default.

```json5
"costs":{"agent.action":null}
```

**An action that costs chronal and leaves a mark.** A cost is paid either way, and only if the agent has it. Effects without a check follow the action.

```json5
"costs":{"agent.chronal":"3"},
"effects":{"event.paradox":{"onSuccess":"1"}}   // A crude fix leaves a mark.
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
