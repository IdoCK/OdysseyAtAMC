const defaultMaxLength = 4_096;
const requestTimeoutMs = 15_000;

export function createTelegramMessages(text: string, maxLength = defaultMaxLength): string[] {
  const normalizedText = text.replace(/\[Book\]\((https:\/\/[^\s)]+)\)/g, "Book: $1");
  const [heading = "", ...entries] = normalizedText.split("\n");

  if (heading.length > maxLength) {
    throw new Error(`Telegram message entry exceeds ${maxLength} characters`);
  }

  for (const entry of entries) {
    if (entry.length > maxLength) {
      throw new Error(`Telegram message entry exceeds ${maxLength} characters`);
    }
  }

  if (entries.length === 0) {
    return [heading];
  }

  const messages: string[] = [];
  let currentMessage = "";

  for (const entry of entries) {
    const messageWithHeading = heading ? `${heading}\n${entry}` : entry;

    if (currentMessage === "") {
      currentMessage = messageWithHeading.length <= maxLength ? messageWithHeading : entry;
      continue;
    }

    const expandedMessage = `${currentMessage}\n${entry}`;
    if (expandedMessage.length <= maxLength) {
      currentMessage = expandedMessage;
      continue;
    }

    messages.push(currentMessage);
    currentMessage = messageWithHeading.length <= maxLength ? messageWithHeading : entry;
  }

  messages.push(currentMessage);
  return messages;
}

export async function sendTelegramMessages(
  config: { botToken: string; chatId: string },
  text: string,
  request: typeof fetch = fetch,
  options: { silent?: boolean } = {},
): Promise<void> {
  if (!config.botToken || !config.chatId) {
    throw new Error("Telegram bot token and chat ID are required");
  }

  const endpoint = `https://api.telegram.org/bot${encodeURIComponent(config.botToken)}/sendMessage`;

  for (const message of createTelegramMessages(text)) {
    const response = await request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(requestTimeoutMs),
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        disable_web_page_preview: true,
        disable_notification: options.silent === true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Telegram delivery failed (${response.status})`);
    }

    let body: unknown;
    try {
      body = await response.json() as unknown;
    } catch {
      throw new Error("Telegram delivery rejected");
    }

    if (typeof body !== "object" || body === null || !("ok" in body) || body.ok !== true) {
      throw new Error("Telegram delivery rejected");
    }
  }
}
