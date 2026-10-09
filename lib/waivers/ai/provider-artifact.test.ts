import { describe, expect, it } from "vitest";
import { inspectProviderArtifact, providerTime } from "@/lib/waivers/ai/provider-artifact";

const RESPONSE = "1. Alpha Back\n2. Bravo Back\n";
const bytes = (text: string) => new TextEncoder().encode(text);
const AT = new Date("2026-10-06T22:15:30.000Z");

describe("providerTime", () => {
  it("reads epoch seconds, epoch milliseconds and zoned ISO strings", () => {
    expect(providerTime(AT.getTime() / 1000)).toEqual(AT);
    expect(providerTime(AT.getTime())).toEqual(AT);
    expect(providerTime("2026-10-06T22:15:30Z")).toEqual(AT);
    expect(providerTime("2026-10-06T17:15:30-05:00")).toEqual(AT);
  });

  it("never guesses a zone or reads free text", () => {
    expect(providerTime("2026-10-06T22:15:30")).toBeNull();
    expect(providerTime("Oct 6, 2026 5:15 PM")).toBeNull();
    expect(providerTime(0)).toBeNull();
    expect(providerTime(-5)).toBeNull();
    expect(providerTime(Number.NaN)).toBeNull();
    expect(providerTime(null)).toBeNull();
  });
});

describe("inspectProviderArtifact", () => {
  it("extracts the assistant message time from a ChatGPT-style export", () => {
    const file = JSON.stringify({
      mapping: {
        p: { message: { author: { role: "user" }, create_time: AT.getTime() / 1000 - 60, content: { parts: ["prompt"] } } },
        r: { message: { author: { role: "assistant" }, create_time: AT.getTime() / 1000, content: { parts: [RESPONSE] } } },
      },
    });
    expect(inspectProviderArtifact(bytes(file), RESPONSE)).toEqual({ utf8: true, json: true, containsResponse: true, extractedAt: AT, extractedKey: "create_time" });
  });

  it("extracts from Claude-style sender messages and keeps the earliest assistant match", () => {
    const later = new Date(AT.getTime() + 3_600_000);
    const file = JSON.stringify({
      chat_messages: [
        { sender: "assistant", created_at: later.toISOString(), text: RESPONSE },
        { sender: "assistant", created_at: AT.toISOString(), text: `Here you go:\n${RESPONSE}` },
      ],
    });
    expect(inspectProviderArtifact(bytes(file), RESPONSE)).toMatchObject({ containsResponse: true, extractedAt: AT, extractedKey: "created_at" });
  });

  it("never takes a time from a message the user wrote, even if it contains the response", () => {
    const file = JSON.stringify({ messages: [{ role: "user", createdAt: AT.toISOString(), content: RESPONSE }] });
    expect(inspectProviderArtifact(bytes(file), RESPONSE)).toMatchObject({ json: true, containsResponse: true, extractedAt: null, extractedKey: null });
  });

  it("never borrows a conversation-level time for an assistant message that has none", () => {
    const file = JSON.stringify({ create_time: AT.getTime() / 1000, messages: [{ role: "assistant", content: RESPONSE }] });
    expect(inspectProviderArtifact(bytes(file), RESPONSE)).toMatchObject({ containsResponse: true, extractedAt: null });
    const nested = JSON.stringify({
      mapping: { r: { create_time: AT.getTime() / 1000, message: { author: { role: "assistant" }, create_time: null, content: { parts: [RESPONSE] } } } },
    });
    expect(inspectProviderArtifact(bytes(nested), RESPONSE)).toMatchObject({ containsResponse: true, extractedAt: null });
  });

  it("requires the exact response text (no trimming or reformatting)", () => {
    const file = JSON.stringify({ messages: [{ role: "assistant", timestamp: AT.getTime(), content: RESPONSE.replace("\n", " \n") }] });
    expect(inspectProviderArtifact(bytes(file), RESPONSE)).toMatchObject({ containsResponse: false, extractedAt: null });
  });

  it("does a plain substring check for non-JSON files and never extracts a time", () => {
    const file = `Exported ${AT.toISOString()}\n\nassistant:\n${RESPONSE}`;
    expect(inspectProviderArtifact(bytes(file), RESPONSE)).toEqual({ utf8: true, json: false, containsResponse: true, extractedAt: null, extractedKey: null });
    expect(inspectProviderArtifact(bytes("unrelated"), RESPONSE)).toMatchObject({ json: false, containsResponse: false });
  });

  it("ignores a leading byte-order mark, as the database does", () => {
    const file = `\uFEFF${JSON.stringify({ role: "assistant", timestamp: AT.getTime(), content: RESPONSE })}`;
    expect(inspectProviderArtifact(bytes(file), RESPONSE)).toMatchObject({ json: true, containsResponse: true, extractedAt: AT, extractedKey: "timestamp" });
  });

  it("rejects invalid UTF-8 and an empty response", () => {
    expect(inspectProviderArtifact(new Uint8Array([0xff, 0xfe, 0x41]), RESPONSE)).toEqual({ utf8: false, json: false, containsResponse: false, extractedAt: null, extractedKey: null });
    expect(inspectProviderArtifact(bytes(RESPONSE), "")).toMatchObject({ utf8: true, containsResponse: false });
  });
});
