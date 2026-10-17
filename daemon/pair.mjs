import { connect } from "node:net";
import { ADMIN_SOCKET, PORT } from "./config.mjs";

const socket = connect(ADMIN_SOCKET);
let code = "";
socket.setEncoding("utf8");
socket.on("data", (d) => (code += d));
socket.on("end", () => console.log(`http://localhost:${PORT}/?pair=${code.trim()}`));
socket.on("error", (err) => {
  console.error(`Weilo Agents is not running, or this is not its container (${err["code"]}).`);
  process.exitCode = 1;
});
