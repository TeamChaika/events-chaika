// Telegram membership checks may take 20 seconds; allow transport time too.
export const TEAM_REQUEST_TIMEOUT = 35000;

export async function teamRequest(
  path: string,
  method = "GET",
  body?: unknown,
  session = "",
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch("/api" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: "Bearer " + session } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TEAM_REQUEST_TIMEOUT),
      });
      const data = await response.json();
      return { response, data };
    } catch (error) {
      const name = (error as Error).name;
      const network = ["AbortError", "TimeoutError", "TypeError"].includes(
        name,
      );
      // Only reads can be retried: a timed-out promo creation may have succeeded.
      if (network && method === "GET" && attempt === 0) continue;
      throw new Error(
        network
          ? "Соединение прервалось или сервер не успел ответить. Проверьте интернет и повторите попытку."
          : "Не удалось прочитать ответ сервера. Повторите попытку позже.",
      );
    }
  }
}
