import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendExtensionMessage } from "../src/shared/messaging.js";

describe("sendExtensionMessage", () => {
  it("resolves successfully when response.ok is true", async () => {
    globalThis.chrome = {
      runtime: {
        sendMessage(msg, callback) {
          callback({ ok: true, data: { status: "ready" } });
        }
      }
    };

    const data = await sendExtensionMessage({ type: "TEST" });
    assert.deepEqual(data, { status: "ready" });
  });

  it("rejects when response.ok is false with error message", async () => {
    globalThis.chrome = {
      runtime: {
        sendMessage(msg, callback) {
          callback({ ok: false, error: "Action rejected" });
        }
      }
    };

    await assert.rejects(
      () => sendExtensionMessage({ type: "TEST" }),
      /Action rejected/
    );
  });

  it("rejects when chrome.runtime.lastError is present", async () => {
    globalThis.chrome = {
      runtime: {
        lastError: { message: "Could not establish connection." },
        sendMessage(msg, callback) {
          callback(undefined);
        }
      }
    };

    await assert.rejects(
      () => sendExtensionMessage({ type: "TEST" }),
      /Could not establish connection\./
    );
  });

  it("rejects when chrome.runtime.sendMessage is unavailable", async () => {
    globalThis.chrome = {};

    await assert.rejects(
      () => sendExtensionMessage({ type: "TEST" }),
      /chrome\.runtime\.sendMessage is unavailable/
    );
  });
});
