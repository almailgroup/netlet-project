import { describe, expect, it } from "vitest";
import { CATALOG_RESPONSE_SCHEMA, DRAFT_TAGS, descriptionFromModel, draftFromModel } from "./catalogDraft.js";

const answer = {
  titleEn: "Samsung Galaxy S26 Ultra 256GB, Black",
  titleAr: "سامسونج جالاكسي S26 الترا 256GB، أسود",
  descriptionEn: "A large phone with a bright screen.\n\n* Storage: 256 GB\n• Colour: black\n## Box\n**Charger** not included",
  descriptionAr: "هاتف كبير بشاشة ساطعة.\n- السعة: 256 جيجابايت",
  department: "electronics",
  tags: ["Phone", "phone", "#samsung", "جوال", "", "x".repeat(40)],
  attributes: [
    { key: "brand", value: "Samsung" },
    { key: "storage", value: "256 GB" },
    { key: "storage", value: "512" },
    { key: "skintype", value: "dry" },
  ],
  seoTitle: "Samsung Galaxy S26 Ultra 256GB",
  seoDescription: "Samsung's large phone with 256 GB of storage, in black.",
};

describe("draftFromModel", () => {
  it("shapes a good answer into a draft", () => {
    const draft = draftFromModel(answer, { department: null })!;
    expect(draft.title).toEqual({ en: answer.titleEn, ar: answer.titleAr });
    expect(draft.department).toBe("electronics");
    /* The unit belongs to the field; a row the department does not ask for goes; a repeat goes. */
    expect(draft.attributes).toEqual([{ key: "brand", value: "Samsung" }, { key: "storage", value: "256" }]);
    expect(draft.missing).toEqual(["model", "ram", "warranty"]);
    expect(draft.tags).toEqual(["phone", "samsung", "جوال"]);
    expect(draft.description.en).toBe("A large phone with a bright screen.\n\n- Storage: 256 GB\n- Colour: black\nBox\nCharger not included");
  });

  it("holds the seller's own department over the model's", () => {
    const draft = draftFromModel({ ...answer, department: "beauty" }, { department: "electronics" })!;
    expect(draft.department).toBe("electronics");
    expect(draft.attributes.map(row => row.key)).toEqual(["brand", "storage"]);
  });

  it("takes no department NetLet does not have", () => {
    const draft = draftFromModel({ ...answer, department: "weapons" }, { department: null })!;
    expect(draft.department).toBeNull();
    expect(draft.attributes).toEqual([]);
    expect(draft.missing).toEqual([]);
  });

  it("keeps an option only as the field spells it", () => {
    const draft = draftFromModel({ ...answer, department: "style", attributes: [{ key: "fit", value: "slim" }, { key: "material", value: "Cotton" }] }, { department: null })!;
    expect(draft.attributes).toEqual([{ key: "fit", value: "Slim" }, { key: "material", value: "Cotton" }]);
    const odd = draftFromModel({ ...answer, department: "style", attributes: [{ key: "fit", value: "baggy" }] }, { department: null })!;
    expect(odd.attributes).toEqual([]);
  });

  it("removes contact details wherever they land, and keeps a barcode", () => {
    const draft = draftFromModel({
      ...answer,
      titleEn: "Phone — call 99887766",
      descriptionEn: "Great phone.\nOrder on WhatsApp 9988 7766\nBarcode 8806095412345",
      tags: ["phone", "noura@gmail.com"],
      seoDescription: "Visit www.example.com",
    }, { department: null })!;
    expect(draft.title.en).toBe("");
    expect(draft.description.en).toBe("Great phone.\nBarcode 8806095412345");
    expect(draft.tags).toEqual(["phone"]);
    expect(draft.seo.description).toBe("");
  });

  it("takes no Arabic name without an Arabic letter in it", () => {
    expect(draftFromModel({ ...answer, titleAr: "Samsung S26" }, { department: null })!.title.ar).toBe("");
  });

  it("caps the tags and the search fields", () => {
    const draft = draftFromModel({ ...answer, tags: Array.from({ length: 20 }, (_, n) => `tag ${n}`), seoTitle: "t".repeat(100) }, { department: null })!;
    expect(draft.tags).toHaveLength(DRAFT_TAGS);
    expect(draft.seo.title.length).toBeLessThanOrEqual(60);
  });

  it("answers null for nothing usable", () => {
    expect(draftFromModel(null, { department: null })).toBeNull();
    expect(draftFromModel("text", { department: null })).toBeNull();
    expect(draftFromModel({ titleEn: "", titleAr: "", descriptionEn: "", descriptionAr: "" }, { department: null })).toBeNull();
  });
});

describe("descriptionFromModel", () => {
  it("turns numbered and starred lists into the page's own", () => {
    expect(descriptionFromModel("Intro\n1. one\n2) two\n* three\n- four")).toBe("Intro\n- one\n- two\n- three\n- four");
  });
});

describe("CATALOG_RESPONSE_SCHEMA", () => {
  it("requires every field it names", () => {
    expect([...CATALOG_RESPONSE_SCHEMA.required].sort()).toEqual(Object.keys(CATALOG_RESPONSE_SCHEMA.properties).sort());
  });
});
