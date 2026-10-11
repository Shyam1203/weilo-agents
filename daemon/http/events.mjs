import { getAgent } from "../agents/agents.mjs";
import { subscribe } from "../agents/runner.mjs";

// Server-sent events: the conversation so far, then each new event. The stream ends when pi
// does; the browser reconnects to the next pi by itself.
export async function events(req, res, id) {
  await getAgent(id);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "exit") res.end();
  };
  let closed = false;
  let unsubscribe;
  req.on("close", () => {
    closed = true;
    unsubscribe?.();
  });
  subscribe(id, send).then(
    (off) => (closed ? off() : (unsubscribe = off)),
    (err) => send({ type: "exit", error: err.message }),
  );
}
