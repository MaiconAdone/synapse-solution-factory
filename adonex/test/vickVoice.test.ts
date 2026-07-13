import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalizeTechnicalTerms,
  extractWakeCommand,
  normalizeVoiceText,
  VickVoiceSession
} from "../src/voice/vickVoice";

describe("Vick voice assistant", () => {
  it("normalizes spoken text for wake-word matching", () => {
    assert.equal(normalizeVoiceText("  VÍCK, ajuste o código! "), "vick ajuste o codigo");
  });

  it("extracts the command after the Vick wake word", () => {
    assert.equal(
      extractWakeCommand("Vick corrija o roteamento do AdoneX", "Vick"),
      "corrija o roteamento do AdoneX"
    );
  });

  it("ignores transcripts without the wake word", () => {
    assert.equal(extractWakeCommand("corrija o roteamento do AdoneX", "Vick"), undefined);
  });

  it("activates on the wake word alone and waits for the command", () => {
    const session = new VickVoiceSession({ enabled: true, wakeWord: "Vick" });
    session.start();

    const result = session.handleTranscript("Vick");

    assert.equal(result.activated, true);
    assert.equal(result.command, "");
    assert.equal(result.state, "listening");
  });

  it("canonicalizes technical terms distorted by pt-BR speech recognition", () => {
    assert.equal(
      canonicalizeTechnicalTerms("ajuste o ado nex com type script e m c p"),
      "ajuste o AdoneX com TypeScript e MCP"
    );
  });

  it("arms, mutes, and routes activated transcripts without blocking", () => {
    const session = new VickVoiceSession({
      enabled: true,
      wakeWord: "Vick",
      engine: "simulated",
      listenSeconds: 8
    });

    assert.equal(session.start().state, "asleep");
    assert.equal(session.toggleMute().state, "muted");
    assert.equal(session.handleTranscript("Vick revise os testes").activated, false);
    assert.equal(session.toggleMute().state, "asleep");

    const result = session.handleTranscript("Vick revise os testes");
    assert.equal(result.activated, true);
    assert.equal(result.command, "revise os testes");
    assert.equal(result.state, "listening");
  });
});
