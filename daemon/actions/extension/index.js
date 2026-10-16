import { DAYS, EVERY, MINUTES } from "../schedule.mjs";
import { daemonTool, list, note, object, str } from "../../tool.mjs";

const ACTION = `Actions are things you do for the user with one tap in the app, and, if they like, by themselves at times they choose ("every morning at 8", "every 10 minutes"). Use them for what the user asks again and again (check an order, order their usual, summarize the inbox), and for anything they want done later or regularly ("remind me tomorrow at 9", "every Monday", "keep checking until it arrives").
Offer one when the user asks for the same kind of thing a second or third time, or asks for something later or regularly; not otherwise. Speak of them as buttons and things that run by themselves, never as scripts or code.
Two kinds:
- agent: a saved request that comes to you as a message when it runs. Put {name} blanks for what changes each time, with a field for each. For tasks that need judgment or differ each time. When it runs by itself the user is away: write the request to stand alone.
- script: JavaScript that runs without you, in seconds and without tokens: for a lookup or step that is the same every time. Write an ES module: export default async function ({ input, browser }) { … return result }. input holds the fields' values. await browser({ action: "open", url }) and the other actions of your browser tool return the page as text, with the user's sign-ins. node: modules work; nothing else can be imported. It has 90 seconds. Return a short string, or an object of a few named values, for the user to read; return { …, stop: true } when what it watches for is over (the order arrived), and it stops running by itself. Always test it with try first, and save it only once it works.
schedule (optional): when it also runs by itself. every: once (with date today, tomorrow or YYYY-MM-DD and times, or in_minutes), minutes (with minutes: ${MINUTES.join(", ")}), hour (times: one HH:MM, for its minutes), day, weekday, or week (with day); times are one or more HH:MM in the user's time. An action that runs by itself needs a default for each field.
Set confirm: true for anything that pays, orders, books or sends. It then asks the user first, the same whether they tap it or it runs by itself (then by a notification): a script waits for them before it runs; an agent action tells you to confirm with ask before the last step.
- op list: your actions, with ids, schedules and scripts.
- op try: run a script with input, without saving it.
- op create: title (a few words), about (one line), kind, request or script, fields (name, label, options, default), confirm, icon, schedule.
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
      confirm: { type: "boolean", description: "Ask the user first, before it pays, orders, books or sends." },
      icon: { type: "string", enum: ["bolt", "package", "food", "cart", "truck", "calendar", "mail", "money", "search", "globe"] },
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
}
