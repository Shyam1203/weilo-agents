export async function request<T = void>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone, ...(body !== undefined && { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Cannot connect to Weilo Agents. Make sure it is running.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `The request failed (${res.status}).`);
  return data as T;
}

/** A readable sentence for any thrown value. */
export const messageOf = (error: unknown, fallback = "An error occurred.") => (error instanceof Error && error.message ? error.message : fallback);
