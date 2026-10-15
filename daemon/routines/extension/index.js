import { DAYS, EVERY } from "../schedule.mjs";
import { call, list, note, object, str } from "../../tool.mjs";

const ROUTINE = `Schedule work for yourself, or change it. At each time the task arrives in this chat as a message and you do it. Use it when the user asks for something later or regularly ("in an hour", "tomorrow at 9", "every morning", "each Monday"). Times are the user's local time.
The user is away when it runs, so write the task to stand alone: what to do, and the choices the user already made. What needs them then is left for the end of the run.
- create: needs title, task and every. For once: give in_minutes (from now), or date (today, tomorrow or YYYY-MM-DD) and times. Otherwise give times: one or more HH:MM (hour needs only one, for its minutes); week also needs day.
- list: shows your routines with their ids.
- update: needs id; give only what changes. A new schedule needs every and its times.
- delete: needs id.
The chat already shows a line when you create, change or delete a routine. Do not repeat the details: answer in one short sentence.`;

const when = (r) => (r.every === "once" ? `once on ${r.date} at ${r.times[0]}` : r.every === "hour" ? `every hour at :${r.times[0].slice(3)}` : `every ${r.every === "week" ? DAYS[r.day] : r.every} at ${r.times.join(" and ")}`);
const describe = (r) => `${r.id}: "${r.title}", ${when(r)} (${r.timezone}). ${r.task}`;

export default function (pi) {
  pi.registerTool({
    name: "routine",
    label: "Routine",
    description: ROUTINE,
    parameters: object(
      {
        action: { type: "string", enum: ["create", "list", "update", "delete"] },
        id: note("From list."),
        title: note("A short name, like 'Morning inbox summary'."),
        task: note("What to do each time, written as an instruction to yourself."),
        every: { type: "string", enum: EVERY },
        times: { ...list(str), description: "HH:MM, 24-hour. For every hour only the minutes count." },
        date: note("For once: today, tomorrow or YYYY-MM-DD."),
        in_minutes: { type: "number", description: "For once: run this many minutes from now." },
        day: { type: "string", enum: DAYS, description: "For every week: the day." },
      },
      ["action"],
    ),
    async execute(_id, { action, id, ...fields }) {
      const agent = process.env.WEILO_AGENT;
      const route = `/agents/${agent}/routines/${encodeURIComponent(id ?? "")}`;
      /** @returns {Promise<{ text: string, details?: object }>} */
      const done = async () => {
        if (action === "create") {
          const routine = await call("POST", `/agents/${agent}/routines`, fields);
          return { text: `Scheduled: ${describe(routine)}`, details: { action, title: routine.title } };
        }
        if (action === "list") {
          const all = await call("GET", `/agents/${agent}/routines`);
          return { text: all.length ? all.map(describe).join("\n") : "No routines yet." };
        }
        if (action === "update") {
          const routine = await call("PUT", route, fields);
          return { text: `Updated: ${describe(routine)}`, details: { action, title: routine.title } };
        }
        if (action === "delete") return (await call("DELETE", route), { text: "Deleted.", details: { action } });
        throw new Error("Unknown action.");
      };
      const { text, details } = await done().catch((err) => ({ text: `Could not do that: ${err.message}`, details: undefined }));
      return { content: [{ type: "text", text }], details };
    },
  });
}
