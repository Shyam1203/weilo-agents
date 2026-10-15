// Prints a link that pairs a browser with Weilo Agents, for the start scripts and for you: run it in the container,
//   docker exec weilo-core node /app/pair.mjs
// It asks the daemon over its admin socket, which only the daemon's user can open: an agent cannot make a code.
import { connect } from "node:net";
import { ADMIN_SOCKET, PORT } from "./config.mjs";

const socket = connect(ADMIN_SOCKET);
let code = "";
socket.setEncoding("utf8");
socket.on("data", (d) => (code += d));
socket.on("end", () => console.log(`http://localhost:${PORT}/?pair=${code.trim()}`));
socket.on("error", (err) => {
  console.error(`Weilo Agents is not running, or this is not its container (${err.code}).`);
  process.exitCode = 1;
});
