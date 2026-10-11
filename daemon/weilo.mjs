// The pi extension every agent gets: the chat's own tools. Browser and routines are extensions of their own (extension/ in browser/ and routines/); memory's tools come from memory/extension.mjs.
// `show`: the agent hands the chat a list of blocks (a table, cards, a chart, buttons, a file, a page
// of its own) and the UI draws them from the tool call itself, live and again from the saved
// conversation. The tool only checks the call.
// `ask`: the agent asks the user a question and waits. Pi's own dialogs carry it: the daemon passes
// the request to the chat and the answer back.

const object = (properties, required) => ({ type: "object", properties, required });
const str = { type: "string" };
const list = (items) => ({ type: "array", items });
const note = (description) => ({ type: "string", description });
const cell = { anyOf: [{ type: "string" }, { type: "number" }] };
const kind = (name) => ({ type: "string", enum: [name] });

const BLOCKS = [
  object({ type: kind("text"), text: note("Markdown.") }, ["type", "text"]),
  object({ type: kind("table"), title: str, columns: list(str), rows: list(list(cell)) }, ["type", "columns", "rows"]),
  object({ type: kind("metrics"), items: list(object({ label: str, value: cell, note: str }, ["label", "value"])) }, ["type", "items"]),
  object(
    {
      type: kind("cards"),
      items: list(object({ title: str, text: str, link: note("A web address."), message: note("Makes the card choosable: choosing it sends this as the user's reply.") }, ["title"])),
    },
    ["type", "items"],
  ),
  object({ type: kind("chart"), title: str, shape: { type: "string", enum: ["bar", "line"] }, points: list(object({ label: str, value: { type: "number" } }, ["label", "value"])) }, ["type", "shape", "points"]),
  object({ type: kind("buttons"), options: list(object({ label: str, message: note("Sent as the user's reply when pressed. Defaults to the label.") }, ["label"])) }, ["type", "options"]),
  object({ type: kind("file"), path: note("A file you made, in the workspace."), name: note("Shown instead of the file's name.") }, ["type", "path"]),
  object({ type: kind("page"), title: str, html: note("One complete HTML document, with its CSS and JavaScript inline.") }, ["type", "html"]),
];

const DESCRIPTION = `Show the user something to look at or use, instead of describing it in text. Blocks appear in the chat in order; add a short text reply as well.
- table: rows and columns to compare things.
- metrics: a few key numbers, each with a label. Not for choices.
- cards: things to read about. Give a card a message to let the user choose it (options, recipes, products...).
- chart: bar or line, one value per label.
- buttons: short choices; pressing one sends its message as the user's reply.
When the blocks let the user choose (cards with a message, or buttons), end your turn right after the show and wait for the choice: do not ask another question or carry on, or the choice can no longer be made.
- file: a file you made in the workspace, for the user to download (pictures show in the chat).
- page: a small app of your own (calculator, form, game, visual) as one self-contained HTML document. It runs in a sandbox: it can load scripts, styles, fonts, images and data from https:// addresses (maps, chart libraries...), but cannot reach the app, the workspace or the user's files, and cannot open frames. Never put the user's private information into an address. Call weilo.reply("text") from a click handler to send the user's reply to you.`;

const ASK = `Ask the user a question and wait for the answer. Give options when the answer is one of a few choices (they pick one); leave them out to let the user type a short answer. Ask only when you cannot continue without the answer.`;

export default function (pi) {
  pi.registerTool({
    name: "show",
    label: "Show",
    description: DESCRIPTION,
    parameters: object({ blocks: { ...list({ anyOf: BLOCKS }), description: "What to show, top to bottom." } }, ["blocks"]),
    async execute(_id, { blocks }) {
      const choice = blocks.some((b) => (b.type === "cards" && b.items.some((i) => i.message)) || b.type === "buttons");
      return { content: [{ type: "text", text: choice ? "Shown to the user. They choose from it now: end your turn and wait for their reply." : "Shown to the user." }] };
    },
  });

  pi.registerTool({
    name: "ask",
    label: "Ask",
    description: ASK,
    parameters: object({ question: str, options: { ...list(str), description: "The choices, a few words each." } }, ["question"]),
    async execute(_id, { question, options }, signal, _update, ctx) {
      const answer = options?.length ? await ctx.ui.select(question, options, { signal }) : await ctx.ui.input(question, "", { signal });
      return { content: [{ type: "text", text: answer ?? "The user did not answer." }] };
    },
  });
}
