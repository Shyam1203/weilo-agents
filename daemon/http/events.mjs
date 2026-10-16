import { getAgent } from "../agents/agents.mjs";
import { subscribe } from "../agents/runner.mjs";
import { watchAgents } from "../agents/status.mjs";
import { HEARTBEAT_MS } from "../config.mjs";
import { markSeen } from "../push.mjs";

// A comment now and then keeps a quiet stream open through proxies (Tailscale Serve and the like).
function openStream(req, res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  const beat = setInterval(() => res.write(": \n\n"), HEARTBEAT_MS);
  req.on("close", () => clearInterval(beat));
}

export async function events(req, res, id) {
  await getAgent(id);
  openStream(req, res);
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

// The app keeps this open while it is on screen: it hears when to read the agent list again, and
// notifications wait while someone is looking.
export function agentStatus(req, res) {
  openStream(req, res);
  const off = watchAgents(() => res.write("data: {}\n\n"));
  req.on("close", () => (off(), markSeen()));
}
