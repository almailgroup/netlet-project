import { describe, expect, it } from "vitest";
import { suggestEmail } from "./emailTypo";

describe("suggestEmail", () => {
  it.each([
    ["noura@gmial.com", "noura@gmail.com"],
    ["noura@gmail.con", "noura@gmail.com"],
    ["noura@gmail.co", "noura@gmail.com"],
    ["fahad@hotmial.com", "fahad@hotmail.com"],
    ["fahad@hotmail.cmo", "fahad@hotmail.com"],
    ["sara@yaho.com", "sara@yahoo.com"],
    ["sara@outlok.com", "sara@outlook.com"],
    ["sara@iclod.com", "sara@icloud.com"],
    ["Noura.Ali@GMAIL.CON", "Noura.Ali@gmail.com"],
    ["office@example.con", "office@example.com"],
    ["office@example.nte", "office@example.net"],
  ])("offers %s → %s", (typed, meant) => {
    expect(suggestEmail(typed)).toBe(meant);
  });

  /* Real domains a letter or two from a famous one are somebody's real address. */
  it.each([
    "noura@gmail.com",
    "noura@mail.com",
    "noura@email.com",
    "noura@me.com",
    "noura@outlook.sa",
    "noura@hotmail.fr",
    "noura@yahoo.co.uk",
    "noura@gmx.de",
    "noura@company.com.kw",
    "noura@example.om",
    "owner@netlet.test",
    "admin@almailgroup.com",
  ])("leaves %s alone", email => {
    expect(suggestEmail(email)).toBeNull();
  });

  it.each(["", "noura", "noura@", "noura@gmai", "@gmial.com", "noura@gmial."])("says nothing while %j is still being typed", email => {
    expect(suggestEmail(email)).toBeNull();
  });
});
