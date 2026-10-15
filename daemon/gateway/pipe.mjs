// A plugin that runs as a program, as an agent's pi sees it: this script is the program pi starts, and passes its input and
// output to the real one, which the daemon starts with the plugin's secrets (plugins.mjs). Run by pi as
//   node /app/gateway/pipe.mjs <plugin name>      (WEILO_API, WEILO_KEY from its mcp.json entry)
import { request } from "node:http";

const name = process.argv[2];
const req = request(`${process.env.WEILO_API}/plugin-pipe/${encodeURIComponent(name)}`, {
  headers: { Connection: "Upgrade", Upgrade: "weilo-pipe", Authorization: `Bearer ${process.env.WEILO_KEY}` },
});
req.on("upgrade", (_res, socket, head) => {
  if (head.length) process.stdout.write(head);
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.on("close", () => process.exit(0));
});
req.on("response", (res) => {
  console.error(`The plugin ${name} cannot start (${res.statusCode}).`);
  process.exit(1);
});
req.on("error", (err) => {
  console.error(`The plugin ${name} cannot start: ${err.message}`);
  process.exit(1);
});
req.end();
