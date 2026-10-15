import { createHash } from "node:crypto";

// The server side of a WebSocket, as small as the daemon needs: accept an upgrade, read the client's messages, send
// messages back. Used for the screen's live view (binary) and the browser's debugging channel (text).

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Answers the upgrade; false when it is not a WebSocket request. `protocol`: one the client offers to echo back.
export function accept(req, socket, protocol) {
  const key = req.headers["sec-websocket-key"];
  if (req.headers.upgrade?.toLowerCase() !== "websocket" || !key) return false;
  const offered = protocol && String(req.headers["sec-websocket-protocol"] ?? "").split(",").some((p) => p.trim() === protocol);
  socket.write(
    ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${createHash("sha1").update(key + GUID).digest("base64")}`, ...(offered ? [`Sec-WebSocket-Protocol: ${protocol}`] : []), "", ""].join("\r\n"),
  );
  return true;
}

// A server-to-client message: one unmasked frame (binary, or text with opcode 0x1).
export function frame(payload, opcode = 0x2) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | opcode, 127]), Buffer.alloc(8)]);
  if (n >= 65536) head.writeBigUInt64BE(BigInt(n), 2);
  return Buffer.concat([head, payload]);
}

// Reads the client's messages (masked frames; a message in several frames is put together) and calls `onMessage(data)`
// with each. Answers pings. Calls `onClose()` on a close frame, or a message longer than `max` bytes.
export function readMessages(socket, head, max, onMessage, onClose) {
  let buffer = head?.length ? Buffer.from(head) : Buffer.alloc(0);
  let parts = [];
  let size = 0;
  const read = () => {
    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      let length = buffer[1] & 0x7f;
      let at = 2;
      if (length === 126) (length = buffer.length >= 4 ? buffer.readUInt16BE(2) : -1), (at = 4);
      else if (length === 127) (length = buffer.length >= 10 ? Number(buffer.readBigUInt64BE(2)) : -1), (at = 10);
      if (length < 0) return; // the length has not all arrived
      if (size + length > max) return onClose();
      const masked = (buffer[1] & 0x80) !== 0;
      const after = at + (masked ? 4 : 0) + length;
      if (buffer.length < after) return;
      const mask = masked ? buffer.subarray(at, at + 4) : null;
      const payload = Buffer.from(buffer.subarray(at + (masked ? 4 : 0), after));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buffer = buffer.subarray(after);
      if (opcode === 0x8) return onClose();
      if (opcode === 0x9) socket.write(frame(payload, 0xa));
      else if (opcode <= 0x2) {
        parts.push(payload);
        size += payload.length;
        if (fin) {
          const message = parts.length === 1 ? parts[0] : Buffer.concat(parts);
          [parts, size] = [[], 0];
          onMessage(message);
        }
      }
    }
  };
  socket.on("data", (data) => {
    buffer = Buffer.concat([buffer, data]);
    read();
  });
  read();
}
