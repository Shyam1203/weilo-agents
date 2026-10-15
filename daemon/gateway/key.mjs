const provider = process.argv[2];
const res = await fetch(`${process.env.WEILO_API}/agents/${process.env.WEILO_AGENT}/model-key/${encodeURIComponent(provider)}`, {
  headers: { authorization: `Bearer ${process.env.WEILO_KEY}` },
});
const data = await res.json().catch(() => ({}));
if (res.ok) process.stdout.write(data.key);
else {
  console.error(data.error ?? `No key for ${provider} (${res.status})`);
  process.exitCode = 1;
}
