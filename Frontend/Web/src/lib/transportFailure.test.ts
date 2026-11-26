import { describe, expect, it } from "vitest";
import { isTransportFailure, saysEmailFailure } from "./transportFailure";

describe("a transport failure", () => {
  it("is each engine's failed fetch, a body that is not JSON, and NetLet's own deadline", () => {
    for (const said of [
      "Failed to fetch",
      "Failed to fetch (netlet.net)",
      "Load failed",
      "NetworkError when attempting to fetch resource.",
      "Network request failed",
      "The network connection was lost.",
      "The Internet connection appears to be offline.",
      `Unexpected token 'd', "down" is not valid JSON`,
      "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
      "Unexpected end of JSON input",
      "JSON.parse: unexpected character at line 1 column 1 of the JSON data",
      "Unable to transform response from server",
      "The request took too long",
      "The operation was aborted.",
      "This operation was aborted",
      "signal is aborted without reason",
    ]) {
      expect(isTransportFailure(said), said).toBe(true);
    }
  });

  it("is never a sentence the server wrote", () => {
    for (const said of [
      "auth.wrongPassword",
      "error.serverProblem",
      "column contact_email does not exist",
      "Store not found",
      "That code has already been used.",
      "",
    ]) {
      expect(isTransportFailure(said), said).toBe(false);
    }
  });
});

describe("which failed email requests are said", () => {
  /* A reset or a one-time code reads every failure as sent so that it cannot
     say which address has an account — but an offline press then said "check
     your email" over a mail that never went. */
  it("says the throttle and a request that never reached NetLet", () => {
    expect(saysEmailFailure("auth.tooManyAttempts")).toBe(true);
    expect(saysEmailFailure("Failed to fetch")).toBe(true);
    expect(saysEmailFailure("Load failed")).toBe(true);
    expect(saysEmailFailure("The request took too long")).toBe(true);
  });

  it("reads a fault of the server's as sent, since one could vary by address", () => {
    expect(saysEmailFailure("error.serverProblem")).toBe(false);
    expect(saysEmailFailure("auth.notConfigured")).toBe(false);
  });
});
