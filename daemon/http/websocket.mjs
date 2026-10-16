import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function accept(req, socket, protocol) {
  const key = req.headers["sec-websocket-key"];
  if (req.headers.upgrade?.toLowerCase() !== "websocket" || !key) return false;
  const offered = protocol && String(req.headers["sec-websocket-protocol"] ?? "").split(",").some((p) => p.trim() === protocol);
  socket.write(
    ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${createHash("sha1").update(key + GUID).digest("base64")}`, ...(offered ? [`Sec-WebSocket-Protocol: ${protocol}`] : []), "", ""].join("\r\n"),
  );
  return true;
}

export function frame(payload, opcode = 0x2) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | opcode, 127]), Buffer.alloc(8)]);
  if (n >= 65536) head.writeBigUInt64BE(BigInt(n), 2);
  return Buffer.concat([head, payload]);
}

export function readMessages(socket, head, max, onMessage, onClose) {
  let chunks = head?.length ? [Buffer.from(head)] : [];
  let held = head?.length ?? 0;
  let need = 2;
  let parts = [];
  let size = 0;
  const next = (buffer) => {
    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      let length = buffer[1] & 0x7f;
      let at = 2;
      if (length === 126) (length = buffer.length >= 4 ? buffer.readUInt16BE(2) : -1), (at = 4);
      else if (length === 127) (length = buffer.length >= 10 ? Number(buffer.readBigUInt64BE(2)) : -1), (at = 10);
      if (length < 0) return [buffer, at];
      if (size + length > max) return (onClose(), null);
      const masked = (buffer[1] & 0x80) !== 0;
      const after = at + (masked ? 4 : 0) + length;
      if (buffer.length < after) return [buffer, after];
      const mask = masked ? buffer.subarray(at, at + 4) : null;
      const payload = Buffer.from(buffer.subarray(at + (masked ? 4 : 0), after));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buffer = buffer.subarray(after);
      if (opcode === 0x8) return (onClose(), null);
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
    return [buffer, 2];
  };
  const read = () => {
    const left = next(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, held));
    if (!left) return void ([chunks, held, need] = [[], 0, Infinity]);
    [chunks, held, need] = [[left[0]], left[0].length, left[1]];
  };
  socket.on("data", (data) => {
    chunks.push(data);
    held += data.length;
    if (held >= need) read();
  });
  read();
}
