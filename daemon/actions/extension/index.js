import { DAYS, EVERY, MINUTES } from "../schedule.mjs";

const ICONS = ["bolt", "package", "food", "cart", "truck", "calendar", "mail", "money", "search", "globe", "tag", "list"];
import { daemonTool, list, note, object, str } from "../../tool.mjs";

const PIN = `Pins are small cards in the app that you keep up to date for the user: a price, an order's status, a list (groceries, to-dos, a cart). They show on the Pins tab next to the actions; the user can tick list items and remove a pin.
Pin something when the user asks you to keep an eye on it, track it, or keep a list; not otherwise. Keep the words short.
To keep a pin fresh by itself, make an action that runs by itself (the action tool) and link it with action: a script returns { pin: { value, detail, tone, steps, items } } and the pin takes it; an agent action reminds you to update the pin. The user is notified only when the pin changes.
- op list: your pins, with ids and items.
- op pin: title, kind, icon, source, value, detail, tone, steps, items, action.
- op update: id, and only what changes (items: the whole list).
- op unpin: id.
The chat shows a line when you pin or unpin: answer in one short sentence.`;

const ACTION = `Actions are things you do for the user with one tap in the app, and, if they like, by themselves at times they choose ("every morning at 8", "every 10 minutes"). Use them for what the user asks again and again (check an order, order their usual, summarize the inbox), and for anything they want done later or regularly ("remind me tomorrow at 9", "every Monday", "keep checking until it arrives").
Offer one when the user asks for the same kind of thing a second or third time, or asks for something later or regularly; not otherwise. Speak of them as buttons and things that run by themselves, never as scripts or code.
Two kinds:
- agent: a saved request that comes to you as a message when it runs. Put {name} blanks for what changes each time, with a field for each. For tasks that need judgment or differ each time. When it runs by itself the user is away: write the request to stand alone.
- script: JavaScript that runs without you, in seconds and without tokens: for a lookup or step that is the same every time. Write an ES module: export default async function ({ input, browser }) { … return result }. input holds the fields' values. await browser({ action: "open", url }) and the other actions of your browser tool return the page as text, with the user's sign-ins. node: modules work; nothing else can be imported. It has 90 seconds. Return a short string, or an object of a few named values, for the user to read; return { …, stop: true } when what it watches for is over (the order arrived), and it stops running by itself. A script that keeps a pin fresh returns { pin: { value, detail, … } } (see the pin tool). Always test it with try first, and save it only once it works.
schedule (optional): when it also runs by itself. every: once (with date today, tomorrow or YYYY-MM-DD and times, or in_minutes), minutes (with minutes: ${MINUTES.join(", ")}), hour (times: one HH:MM, for its minutes), day, weekday, or week (with day); times are one or more HH:MM in the user's time. An action that runs by itself needs a default for each field.
Anything that pays, orders, books or sends must be an agent action, never a script: when it runs, you confirm the details with ask first (the user gets a notification when it runs by itself).
- op list: your actions, with ids, schedules and scripts.
- op try: run a script with input, without saving it.
- op create: title (a few words), about (one line), kind, request or script, fields (name, label, options, default), icon, schedule.
- op update: id, and only what changes. Use it to fix a script that fails. schedule: null alone stops it running by itself, without asking the user.
- op delete: id.
- op run: id and input: run a saved script yourself.
The user approves each new or changed action in this chat. If they do not, accept it and do not ask again unless they ask. The chat shows a line when an action is saved or deleted: answer in one short sentence.`;

export default function (pi) {
  daemonTool(
    pi,
    "action",
    "Action",
    process.env.WEILO_ISOLATED ? `${ACTION}\nYou are isolated: you can save agent actions only.` : ACTION,
    {
      op: { type: "string", enum: ["list", "try", "create", "update", "delete", "run"] },
      id: note("From list."),
      title: note("A few words, like 'Check my order'."),
      about: note("One line: what it does, in plain words."),
      kind: { type: "string", enum: ["agent", "script"] },
      request: note("agent: the message you get when it runs, with {name} blanks for the fields."),
      script: note("script: an ES module that exports a default async function ({ input, browser })."),
      fields: {
        ...list(object({ name: note("lowercase_with_underscores"), label: str, options: { ...list(str), description: "Choices, if the value is one of a few." }, default: str }, ["name"])),
        description: "What the user fills in before it runs.",
      },
      icon: { type: "string", enum: ICONS },
      schedule: {
        anyOf: [
          object(
            {
              every: { type: "string", enum: EVERY },
              times: { ...list(str), description: "HH:MM, 24-hour, the user's time." },
              minutes: { type: "number", enum: MINUTES },
              day: { type: "string", enum: DAYS, description: "every week: the day." },
              date: note("once: today, tomorrow or YYYY-MM-DD."),
              in_minutes: { type: "number", description: "once: this many minutes from now." },
            },
            ["every"],
          ),
          { type: "null" },
        ],
        description: "When it also runs by itself; null to stop that.",
      },
      input: { type: "object", additionalProperties: { type: "string" }, description: "try and run: a value for each field." },
    },
    ["op"],
  );

  daemonTool(
    pi,
    "pin",
    "Pin",
    PIN,
    {
      op: { type: "string", enum: ["list", "pin", "update", "unpin"] },
      id: note("From list."),
      kind: { type: "string", enum: ["status", "list"], description: "status: a value that changes (a price, an order). list: items to tick." },
      title: note("A few words, like 'AirPods Pro' or 'Groceries'."),
      icon: { type: "string", enum: ICONS },
      source: note("Where it comes from, a word or two: 'Best Buy'."),
      value: note("status: the big text, a few characters: '$199', 'Out for delivery'."),
      detail: note("One short line under it: '↓ $20 since Monday', 'about 7:42 PM', 'Tells you below $180'."),
      tone: { type: "string", enum: ["good", "bad", "plain"], description: "Colors the detail: good news, bad news, or neither." },
      steps: { ...object({ done: { type: "number" }, total: { type: "number" } }, ["done", "total"]), description: "status: progress, like step 3 of 4 for a delivery." },
      items: { ...list(object({ text: str, done: { type: "boolean" } }, ["text"])), description: "list: all of its items (this replaces them)." },
      action: note("The id of the action that keeps it fresh (action list); empty to unlink."),
    },
    ["op"],
  );
}
