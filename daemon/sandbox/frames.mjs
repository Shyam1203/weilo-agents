export const encode = (type, data) => {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === "string" ? data : JSON.stringify(data));
  const head = Buffer.alloc(5);
  head.write(type, 0, "latin1");
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
};

export function decoder(onFrame) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    while (buffer.length >= 5) {
      const length = buffer.readUInt32BE(1);
      if (buffer.length < 5 + length) return;
      onFrame(String.fromCharCode(buffer[0]), buffer.subarray(5, 5 + length));
      buffer = buffer.subarray(5 + length);
    }
  };
}
