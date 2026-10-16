import { describe, expect, it, vi } from "vitest";
import { createTelegramMessages, sendTelegramMessages } from "../src/cloud/telegram.js";

function telegramOkResponse(messageId = 1): Response {
  return new Response(JSON.stringify({
    ok: true,
    result: {
      message_id: messageId,
      date: 1_786_726_400,
      chat: { id: 123, type: "private", first_name: "Monitor" },
      text: "delivered",
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("createTelegramMessages", () => {
  it("converts monitor booking links into plain-text booking URLs", () => {
    expect(createTelegramMessages("New:\n- Tue — [Book](https://amc/1)")).toEqual([
      "New:\n- Tue — Book: https://amc/1",
    ]);
  });

  it("preserves every complete screening entry while splitting messages", () => {
    const messages = createTelegramMessages([
      "New:",
      "- Tue — [Book](https://amc/1)",
      "- Wed — [Book](https://amc/2)",
      "- Thu — [Book](https://amc/3)",
    ].join("\n"), 60);

    expect(messages.flatMap((message) => message.match(/https:\/\/amc\/\d/g) ?? [])).toEqual([
      "https://amc/1",
      "https://amc/2",
      "https://amc/3",
    ]);
    expect(messages.every((message) => message.length <= 60)).toBe(true);
    expect(messages.every((message) => {
      const lines = message.split("\n");
      const entries = lines.filter((line) => line.startsWith("- "));
      return lines.every((line) => line === "New:" || [
        "- Tue — Book: https://amc/1",
        "- Wed — Book: https://amc/2",
        "- Thu — Book: https://amc/3",
      ].includes(line)) && entries.length > 0;
    })).toBe(true);
  });

  it("rejects an atomic entry that exceeds the message limit", () => {
    expect(() => createTelegramMessages("New:\n- Tue — [Book](https://amc/1)", 20)).toThrow(
      "Telegram message entry exceeds 20 characters",
    );
  });

  it("rejects a heading-only message that exceeds the message limit", () => {
    expect(() => createTelegramMessages("x".repeat(21), 20)).toThrow(
      "Telegram message entry exceeds 20 characters",
    );
  });

  it("rejects an overlong heading instead of silently omitting it from entry chunks", () => {
    expect(() => createTelegramMessages(`${"h".repeat(21)}\n- entry`, 20)).toThrow(
      "Telegram message entry exceeds 20 characters",
    );
  });
});

describe("sendTelegramMessages", () => {
  it("marks a requested daily status as a silent Telegram message", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(telegramOkResponse());

    await sendTelegramMessages(
      { botToken: "bot-token", chatId: "chat-id" },
      "Daily status",
      request,
      { silent: true },
    );

    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      disable_notification: true,
    });
  });

  it("explicitly enables notifications for a requested loud message", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(telegramOkResponse());

    await sendTelegramMessages(
      { botToken: "bot-token", chatId: "chat-id" },
      "New screening",
      request,
      { silent: false },
    );

    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      disable_notification: false,
    });
  });

  it("sends chunks sequentially as JSON Telegram posts", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const request = vi.fn<typeof fetch>()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(telegramOkResponse(2));
    const firstEntry = `- ${"a".repeat(4_000)} [Book](https://amc/1)`;
    const secondEntry = `- ${"b".repeat(4_000)} [Book](https://amc/2)`;
    const firstMessage = `New:\n- ${"a".repeat(4_000)} Book: https://amc/1`;
    const secondMessage = `New:\n- ${"b".repeat(4_000)} Book: https://amc/2`;
    const sending = sendTelegramMessages(
      { botToken: "bot/token", chatId: "chat-id" },
      ["New:", firstEntry, secondEntry].join("\n"),
      request,
    );

    expect(request).toHaveBeenCalledTimes(1);
    resolveFirst?.(telegramOkResponse(1));
    await sending;

    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://api.telegram.org/botbot%2Ftoken/sendMessage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: expect.any(AbortSignal),
        body: JSON.stringify({
          chat_id: "chat-id",
          text: firstMessage,
          disable_web_page_preview: true,
          disable_notification: false,
        }),
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://api.telegram.org/botbot%2Ftoken/sendMessage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: expect.any(AbortSignal),
        body: JSON.stringify({
          chat_id: "chat-id",
          text: secondMessage,
          disable_web_page_preview: true,
          disable_notification: false,
        }),
      },
    );
  });

  it("rejects failed responses without exposing secrets or response details", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("token and body", { status: 503 }));

    const delivery = sendTelegramMessages(
      { botToken: "private-token", chatId: "chat-id" },
      "New:\n- Tue — [Book](https://amc/1)",
      request,
    );

    await expect(delivery).rejects.toHaveProperty("message", "Telegram delivery failed (503)");
  });

  it.each([
    ["an API rejection", JSON.stringify({ ok: false, error_code: 400, description: "private-token invalid" })],
    ["malformed JSON", "not-json private-token"],
    ["a missing ok field", JSON.stringify({ result: { message_id: 1 }, detail: "private-token" })],
  ])("rejects %s in a successful HTTP response without exposing response details", async (_case, body) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const delivery = sendTelegramMessages(
      { botToken: "private-token", chatId: "chat-id" },
      "New:\n- Tue \u2014 [Book](https://amc/1)",
      request,
    );

    await expect(delivery).rejects.toHaveProperty("message", "Telegram delivery rejected");
  });

  it("retries every chunk after a partial multi-chunk rejection, so an earlier chunk can duplicate", async () => {
    const responses = [
      telegramOkResponse(1),
      new Response(JSON.stringify({ ok: false, description: "retry" }), { status: 200 }),
      telegramOkResponse(2),
      telegramOkResponse(3),
    ];
    const sentTexts: string[] = [];
    const request = vi.fn<typeof fetch>(async (_endpoint, init) => {
      sentTexts.push(JSON.parse(String(init?.body)).text as string);
      const response = responses.shift();
      if (!response) throw new Error("Unexpected request");
      return response;
    });
    const text = [
      "New:",
      `- ${"a".repeat(4_000)} [Book](https://amc/1)`,
      `- ${"b".repeat(4_000)} [Book](https://amc/2)`,
    ].join("\n");

    await expect(sendTelegramMessages(
      { botToken: "private-token", chatId: "chat-id" },
      text,
      request,
    )).rejects.toThrow("Telegram delivery rejected");
    await sendTelegramMessages({ botToken: "private-token", chatId: "chat-id" }, text, request);

    expect(sentTexts).toHaveLength(4);
    expect(sentTexts[0]).toBe(sentTexts[2]);
    expect(sentTexts[1]).toBe(sentTexts[3]);
  });

  it.each([
    [{ botToken: "", chatId: "chat-id" }],
    [{ botToken: "bot-token", chatId: "" }],
  ])("rejects incomplete credentials before a request", async (config) => {
    const request = vi.fn<typeof fetch>();

    await expect(sendTelegramMessages(config, "New:", request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
