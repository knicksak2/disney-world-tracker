import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  REQUEST_ID_HEADER,
  genRequestId,
  registerRequestId,
} from "../requestId.js";
import { loggerOptions } from "../../logger.js";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("genRequestId", () => {
  it("returns a UUID v4 when no inbound header is provided", () => {
    const id = genRequestId();
    expect(id).toMatch(UUID_V4_RE);
  });

  it("returns distinct ids on repeated calls", () => {
    const a = genRequestId();
    const b = genRequestId();
    expect(a).not.toBe(b);
  });

  it("honors a well-formed inbound x-request-id header", () => {
    const inbound = "11111111-2222-4333-8444-555555555555";
    const id = genRequestId({ headers: { [REQUEST_ID_HEADER]: inbound } });
    expect(id).toBe(inbound);
  });

  it("rejects a malformed inbound x-request-id and mints a fresh UUID v4", () => {
    const id = genRequestId({ headers: { [REQUEST_ID_HEADER]: "not-a-uuid" } });
    expect(id).toMatch(UUID_V4_RE);
    expect(id).not.toBe("not-a-uuid");
  });
});

describe("registerRequestId", () => {
  it("attaches request_id to the per-request logger and echoes it on the response", async () => {
    const app = Fastify({ logger: loggerOptions, genReqId: genRequestId });
    await registerRequestId(app);

    let observedBindings: Record<string, unknown> | undefined;
    app.get("/ping", async (req) => {
      // Pino exposes child bindings via `bindings()`.
      observedBindings = (req.log as unknown as {
        bindings(): Record<string, unknown>;
      }).bindings();
      return { ok: true };
    });

    const res = await app.inject({ method: "GET", url: "/ping" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const headerId = res.headers[REQUEST_ID_HEADER];
    expect(typeof headerId).toBe("string");
    expect(headerId).toMatch(UUID_V4_RE);
    expect(observedBindings).toBeDefined();
    expect(observedBindings!["request_id"]).toBe(headerId);
  });

  it("propagates an inbound x-request-id onto the response header", async () => {
    const app = Fastify({ logger: loggerOptions, genReqId: genRequestId });
    await registerRequestId(app);
    app.get("/ping", async () => ({ ok: true }));

    const inbound = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const res = await app.inject({
      method: "GET",
      url: "/ping",
      headers: { [REQUEST_ID_HEADER]: inbound },
    });
    await app.close();

    expect(res.headers[REQUEST_ID_HEADER]).toBe(inbound);
  });
});
