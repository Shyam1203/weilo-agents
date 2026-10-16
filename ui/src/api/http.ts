export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly pair = false) {
    super(message);
  }
}

/** Fetches JSON; `failed` words the error when the reply does not give one. */
export async function fetchJson<T>(url: string, init: RequestInit, failed: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Cannot connect to Weilo Agents. Make sure it is running.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new RequestError(data?.error || `${failed} (${res.status}).`, res.status, data?.pair === true);
  return data as T;
}

export const request = <T = void>(method: string, url: string, body?: unknown) =>
  fetchJson<T>(
    url,
    {
      method,
      headers: { "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone, ...(body !== undefined && { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    "The request failed",
  );

export const messageOf = (error: unknown, fallback = "An error occurred.") => (error instanceof Error && error.message ? error.message : fallback);
