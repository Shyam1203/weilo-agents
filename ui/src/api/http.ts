export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly pair = false) {
    super(message);
  }
}

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
  if (!res.ok) throw new RequestError(data?.error || `The request failed (${res.status}).`, res.status, data?.pair === true);
  return data as T;
}

export const messageOf = (error: unknown, fallback = "An error occurred.") => (error instanceof Error && error.message ? error.message : fallback);
