import { request as http } from "node:http";
import { request as https } from "node:https";

const HOP = new Set(["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer", "cookie"]);

export const forward = (req, res, target, headers) =>
  new Promise((resolve, reject) => {
    const upstream = (target.protocol === "https:" ? https : http)(target, { method: req.method, headers }, (answer) => {
      res.writeHead(answer.statusCode, Object.fromEntries(Object.entries(answer.headers).filter(([name]) => !HOP.has(name))));
      answer.pipe(res);
      answer.on("end", resolve);
      answer.on("error", reject);
    });
    upstream.on("error", reject);
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });

export const headersOf = (req, drop = [], change = (value) => value) =>
  Object.fromEntries(Object.entries(req.headers).filter(([name]) => !HOP.has(name) && !drop.includes(name)).map(([name, value]) => [name, change(String(value))]));
