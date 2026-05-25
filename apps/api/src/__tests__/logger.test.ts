import { describe, expect, it } from "vitest";
import {
  REDACT_CENSOR,
  REDACT_PATHS,
  createLogger,
  loggerOptions,
  scrubPasswordsDeep,
} from "../logger.js";
import { Writable } from "node:stream";

/**
 * Small in-memory sink so we can capture the JSON pino emits and assert on
 * the actual on-the-wire log payload — not just the configured options.
 */
function captureLogs(): { lines: Array<Record<string, unknown>>; stream: Writable } {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _enc, cb): void {
      const text = String(chunk).trim();
      if (text.length > 0) {
        for (const part of text.split("\n")) {
          if (part.length > 0) lines.push(JSON.parse(part) as Record<string, unknown>);
        }
      }
      cb();
    },
  });
  return { lines, stream };
}

describe("logger redaction", () => {
  it("declares the explicit redact paths required by task 2.2", () => {
    expect(REDACT_PATHS).toContain("req.body.password");
    expect(REDACT_PATHS).toContain("req.headers.authorization");
    expect(REDACT_PATHS).toContain("req.body.token");
    expect(REDACT_PATHS).toContain("req.body.avatar");
  });

  it("redacts shallow req.body.password via pino paths", () => {
    const { lines, stream } = captureLogs();
    const log = createLogger({ ...loggerOptions, level: "info" }, stream);
    log.info({ req: { body: { password: "hunter2", username: "alice" } } }, "login");
    const entry = lines[0]!;
    const req = entry["req"] as { body: { password: unknown; username: unknown } };
    expect(req.body.password).toBe(REDACT_CENSOR);
    expect(req.body.username).toBe("alice");
  });

  it("redacts authorization header and body.token / body.avatar", () => {
    const { lines, stream } = captureLogs();
    const log = createLogger({ ...loggerOptions, level: "info" }, stream);
    log.info(
      {
        req: {
          headers: { authorization: "Bearer secret-token", "user-agent": "ua" },
          body: { token: "csrf-xyz", avatar: "<<binary>>" },
        },
      },
      "request"
    );
    const entry = lines[0]!;
    const req = entry["req"] as {
      headers: { authorization: unknown; "user-agent": unknown };
      body: { token: unknown; avatar: unknown };
    };
    expect(req.headers.authorization).toBe(REDACT_CENSOR);
    expect(req.headers["user-agent"]).toBe("ua");
    expect(req.body.token).toBe(REDACT_CENSOR);
    expect(req.body.avatar).toBe(REDACT_CENSOR);
  });

  it("redacts deeply nested fields literally named `password`", () => {
    const scrubbed = scrubPasswordsDeep({
      level1: { level2: { level3: { password: "hunter2", other: "ok" } } },
      arr: [{ password: "p1" }, { password: "p2" }],
    }) as {
      level1: { level2: { level3: { password: string; other: string } } };
      arr: Array<{ password: string }>;
    };
    expect(scrubbed.level1.level2.level3.password).toBe(REDACT_CENSOR);
    expect(scrubbed.level1.level2.level3.other).toBe("ok");
    expect(scrubbed.arr[0]!.password).toBe(REDACT_CENSOR);
    expect(scrubbed.arr[1]!.password).toBe(REDACT_CENSOR);
  });

  it("does not mutate the input object", () => {
    const input = { password: "hunter2", nested: { password: "deep" } };
    const before = JSON.stringify(input);
    scrubPasswordsDeep(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("the literal password string never reaches the emitted log line", () => {
    const { lines, stream } = captureLogs();
    const log = createLogger({ ...loggerOptions, level: "info" }, stream);
    const PLAINTEXT = "S3cretSauce!";
    log.info(
      {
        req: { body: { password: PLAINTEXT } },
        misc: { deeply: { nested: { password: PLAINTEXT } } },
        password: PLAINTEXT,
      },
      "registration"
    );
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain(PLAINTEXT);
  });
});
