import { describe, expect, it } from "vitest";
import { isTransportFailure } from "./transportFailure";

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
