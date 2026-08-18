import { describe, expect, test } from "bun:test";
import { gmailSendEmailAction } from "../../src/gmail/actions/send-email";
import { createFakeContext, createFakeHttp, failure, googleOAuth, ok } from "../support/fake-kit-context";

const input = {
  to: "ada@example.com",
  subject: "Invoice 1024",
  body: "Attached.",
  bodyType: "text",
};

function decodeRaw(body: unknown): string {
  const raw = (body as { raw: string }).raw;

  return Buffer.from(raw, "base64url").toString("utf8");
}

describe("gmail.sendEmail", () => {
  test("posts the assembled message to Gmail with the connection's token", async () => {
    const http = createFakeHttp([ok({ id: "msg-1", threadId: "thread-1" })]);

    const output = await gmailSendEmailAction.invoke(createFakeContext({ http, input, auth: googleOAuth }));

    const call = http.calls[0];

    expect(call?.method).toBe("POST");
    expect(call?.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(call?.headers?.authorization).toBe("Bearer test-access-token");
    expect(decodeRaw(call?.body)).toContain("To: ada@example.com");
    expect(output).toMatchObject({ messageId: "msg-1", threadId: "thread-1" });
  });

  /**
   * A step's output goes into the run journal, and a journal is not the place to keep a second copy of
   * everything anyone has ever emailed.
   */
  test("reports what was sent without echoing the body back into the journal", async () => {
    const http = createFakeHttp([ok({ id: "msg-1" })]);

    const output = await gmailSendEmailAction.invoke(
      createFakeContext({ http, input: { ...input, body: "Bank details: 1234" }, auth: googleOAuth }),
    );

    expect(JSON.stringify(output)).not.toContain("Bank details");
    expect(output).toMatchObject({ to: "ada@example.com", subject: "Invoice 1024" });
  });

  test("sends cc and bcc when the step names them", async () => {
    const http = createFakeHttp([ok({ id: "msg-1" })]);

    await gmailSendEmailAction.invoke(
      createFakeContext({ http, input: { ...input, cc: "cc@example.com", bcc: "bcc@example.com" }, auth: googleOAuth }),
    );

    const message = decodeRaw(http.calls[0]?.body);

    expect(message).toContain("Cc: cc@example.com");
    expect(message).toContain("Bcc: bcc@example.com");
  });

  describe("when something is wrong", () => {
    test("no connection names the step, rather than failing somewhere upstream", async () => {
      const context = createFakeContext({ input, stepName: "Send the receipt" });

      await expect(gmailSendEmailAction.invoke(context)).rejects.toThrow(/Send the receipt/);
    });

    /** The difference between a bug and "reconnect Google" is in the message Gmail sends back. */
    test("an error status becomes a step failure carrying Gmail's own explanation", async () => {
      const http = createFakeHttp([
        failure(403, { error: { message: "Request had insufficient authentication scopes." } }),
      ]);

      await expect(gmailSendEmailAction.invoke(createFakeContext({ http, input, auth: googleOAuth }))).rejects.toThrow(
        /insufficient authentication scopes/,
      );
    });

    test("an error status with no parseable body still says what happened", async () => {
      const http = createFakeHttp([failure(503, "<html>Service Unavailable</html>")]);

      await expect(gmailSendEmailAction.invoke(createFakeContext({ http, input, auth: googleOAuth }))).rejects.toThrow(
        /HTTP 503/,
      );
    });

    /**
     * A 200 whose body is not what the kit expects means the step cannot honestly report a message id, so
     * it fails rather than returning undefined and letting a later step act on it.
     */
    test("a success with an unexpected body fails rather than reporting nothing", async () => {
      const http = createFakeHttp([ok({ unexpected: true })]);

      await expect(gmailSendEmailAction.invoke(createFakeContext({ http, input, auth: googleOAuth }))).rejects.toThrow(
        /not the shape/,
      );
    });

    test("a token connection is refused, since Gmail needs OAuth", async () => {
      const context = createFakeContext({
        input,
        auth: { kind: "token", connectorId: "apiToken", token: "nope" },
      });

      await expect(gmailSendEmailAction.invoke(context)).rejects.toThrow(/OAuth/);
    });
  });
});
