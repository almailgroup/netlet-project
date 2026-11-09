import { describe, expect, it } from "vitest";
import { databaseRegionOf } from "./db.js";

describe("databaseRegionOf", () => {
  it("reads the region a Supabase pooler address names", () => {
    expect(databaseRegionOf("postgresql://postgres.abcdefgh:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres")).toBe("eu-central-1");
    expect(databaseRegionOf("postgresql://postgres.abcdefgh:pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres")).toBe("us-east-2");
    expect(databaseRegionOf("postgresql://postgres.abcdefgh:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres")).toBe("ap-southeast-1");
  });

  it("says nothing it cannot read off the address", () => {
    expect(databaseRegionOf("postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres")).toBeNull();
    expect(databaseRegionOf("postgres://walk@localhost:5499/netlet")).toBeNull();
    expect(databaseRegionOf("not a url")).toBeNull();
    expect(databaseRegionOf(undefined)).toBeNull();
  });
});
