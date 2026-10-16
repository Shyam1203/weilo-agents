import { daemonTool, list, note, object, str } from "../../tool.mjs";

const ACTION = `Save one-tap actions for what the user asks you again and again (check an order's status, order their usual, track a package): they tap it in the app instead of typing. Offer one when the user asks for the same kind of thing a second or third time, or asks for an action; not otherwise.
Two kinds:
- agent: a saved request that comes to you as a message when tapped. Put {name} blanks for what changes each time, with a field for each. For tasks that need judgment or differ each time.
- script: JavaScript that runs without you, in seconds and without tokens: for a lookup or step that is the same every time. Write an ES module: export default async function ({ input, browser }) { … return result }. input holds the fields' values. await browser({ action: "open", url }) and the other actions of your browser tool return the page as text, with the user's sign-ins. node: modules work; nothing else can be imported. It has 90 seconds. Return a short string, or an object of a few named values, for the user to read. Always test it with try first, and save it only once it works.
Set confirm: true for anything that pays, orders, books or sends: a script then asks the user before each run; an agent action tells you to confirm with ask before the last step.
- op list: your actions, with ids and scripts.
- op try: run a script with input, without saving it.
- op create: title (a few words), about (one line), kind, request or script, fields (name, label, options, default), confirm, icon.
- op update: id, and only what changes. Use it to fix a script that fails.
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
      title: note("A few words, like 'Check order status'."),
      about: note("One line: what it does."),
      kind: { type: "string", enum: ["agent", "script"] },
      request: note("agent: the message you get when it is tapped, with {name} blanks for the fields."),
      script: note("script: an ES module that exports a default async function ({ input, browser })."),
      fields: {
        ...list(object({ name: note("lowercase_with_underscores"), label: str, options: { ...list(str), description: "Choices, if the value is one of a few." }, default: str }, ["name"])),
        description: "What the user fills in before it runs.",
      },
      confirm: { type: "boolean", description: "Ask the user before it pays, orders, books or sends." },
      icon: { type: "string", enum: ["bolt", "package", "food", "cart", "truck", "calendar", "mail", "money", "search", "globe"] },
      input: { type: "object", additionalProperties: { type: "string" }, description: "try and run: a value for each field." },
    },
    ["op"],
  );
}
