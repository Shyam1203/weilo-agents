// The access token of a provider signed in with an account, for the agent's pi, which asks for it before each request
// (`apiKey: "!node /app/gateway/key.mjs <provider>"` in its models.json; models.mjs). Prints the token, or nothing.
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
