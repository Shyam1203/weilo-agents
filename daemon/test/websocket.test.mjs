import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { frame, readMessages } from "../http/websocket.mjs";

const masked = (payload, opcode, fin = true) => {
  const mask = Buffer.from([1, 2, 3, 4]);
  const n = payload.length;
  const head = n < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | n]) : Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, n >> 8, n & 255]);
  return Buffer.concat([head, mask, Buffer.from(payload.map((b, i) => b ^ mask[i & 3]))]);
};

function socket() {
  const s = Object.assign(new EventEmitter(), { sent: [], write: (data) => s.sent.push(data) });
  return s;
}

test("messages are unmasked and joined from fragments, however the bytes arrive", () => {
  const s = socket();
  const got = [];
  readMessages(s, Buffer.alloc(0), 1 << 20, (m) => got.push(m.toString()), () => got.push("closed"));
  const big = Buffer.alloc(300, 97);
  const bytes = Buffer.concat([masked(Buffer.from("hel"), 0x1, false), masked(Buffer.from("lo"), 0x0), masked(big, 0x2), masked(Buffer.from("hi"), 0x9), masked(Buffer.alloc(0), 0x8)]);
  for (let i = 0; i < bytes.length; i += 7) s.emit("data", bytes.subarray(i, i + 7));
  assert.deepEqual(got, ["hello", big.toString(), "closed"]);
  assert.deepEqual(s.sent, [frame(Buffer.from("hi"), 0xa)]);
});

test("a message over the limit closes the socket", () => {
  const s = socket();
  let closed = false;
  readMessages(s, masked(Buffer.alloc(200), 0x2), 100, () => assert.fail("no message"), () => (closed = true));
  assert.ok(closed);
});

test("frames carry their length in the right form", () => {
  assert.deepEqual([...frame(Buffer.from("ab")).subarray(0, 2)], [0x82, 2]);
  assert.deepEqual([...frame(Buffer.alloc(300)).subarray(0, 4)], [0x82, 126, 1, 44]);
  assert.equal(frame(Buffer.alloc(70000)).readBigUInt64BE(2), 70000n);
});
