import { describe, expect, it } from "vitest";
import { departmentsFromModel, mapHeaders, parseCsv, planUpload, suggestDepartment, templateCsv } from "./bulkUpload.js";

describe("reading what a spreadsheet actually exports", () => {
  /* Excel writes one, and an exact match on "title" fails on every file a
     Windows seller sends without this. */
  it("strips the byte-order mark Excel puts in front of the first header", () => {
    expect(parseCsv("﻿title,price\nLamp,10.000")[0]).toEqual(["title", "price"]);
  });

  it("keeps a comma inside a quoted field", () => {
    const [, row] = parseCsv('title,description\nLamp,"Warm, brass, and heavy"');
    expect(row).toEqual(["Lamp", "Warm, brass, and heavy"]);
  });

  it("keeps a newline inside a quoted field", () => {
    const [, row] = parseCsv('title,description\nLamp,"Two lines\nof detail"');
    expect(row[1]).toBe("Two lines\nof detail");
  });

  it("reads a doubled quote as one quote", () => {
    const [, row] = parseCsv('title\n"A 12"" shade"');
    expect(row[0]).toBe('A 12" shade');
  });

  /* A trailing \r silently becomes part of the last value, and "12.000\r"
     parses as NaN — which is a price refused for no reason anybody can see. */
  it("does not leave a carriage return on the last column", () => {
    expect(parseCsv("title,price\r\nLamp,12.000\r\n")[1]).toEqual(["Lamp", "12.000"]);
  });

  it("drops blank lines rather than reading them as products", () => {
    expect(parseCsv("title\nLamp\n\n\nKettle\n")).toHaveLength(3);
  });
});

describe("finding the columns", () => {
  it("matches a header whatever case, spacing or underscores it uses", () => {
    const found = mapHeaders(["Product Name", "Compare_At_Price", "QTY"]);
    expect(found.title).toBe(0);
    expect(found.compareAtPrice).toBe(1);
    expect(found.stock).toBe(2);
  });

  it("reports an absent column rather than guessing one", () => {
    expect(mapHeaders(["title"]).price).toBe(-1);
  });
});

describe("planning an import", () => {
  const file = (body: string) => planUpload(`title,sku,price,stock,category,description\n${body}`);

  it("reads a good row into a draft", () => {
    const plan = file("Brass Lamp,LAMP-1,24.500,12,Home & Kitchen,A warm lamp");
    expect(plan.problems).toEqual([]);
    expect(plan.products[0]).toMatchObject({
      line: 2, title: "Brass Lamp", sku: "LAMP-1", price: "24.500", stock: 12, category: "Home & Kitchen",
    });
  });

  /* A problem nobody can locate is a problem nobody can fix, and the line
     number is the whole of what makes a 400-row file correctable. */
  it("points at the line a problem is on", () => {
    const plan = file("Lamp,,10.000,1,,\n,,10.000,1,,\nKettle,,nope,1,,");
    expect(plan.problems).toEqual([
      { line: 3, column: "title", reason: "bulk.noTitle" },
      { line: 4, column: "price", reason: "bulk.badPrice" },
    ]);
    expect(plan.products).toHaveLength(1);
  });

  it("refuses a price that is not money this shop can hold", () => {
    expect(file("Lamp,,12.0005,1,,").problems[0].reason).toBe("bulk.badPrice");
    expect(file("Lamp,,-5,1,,").problems[0].reason).toBe("bulk.badPrice");
    expect(file("Lamp,,KWD 12,1,,").problems[0].reason).toBe("bulk.badPrice");
  });

  it("takes an empty stock cell as none in the warehouse", () => {
    expect(file("Lamp,,10.000,,,").products[0].stock).toBe(0);
  });

  it("refuses a fractional stock rather than rounding somebody's count", () => {
    expect(file("Lamp,,10.000,1.5,,").problems[0].reason).toBe("bulk.badStock");
  });

  /* A file naming one code twice contradicts itself, and picking either row
     is choosing for the seller. */
  it("refuses a file that names one sku twice", () => {
    const plan = file("Lamp,LAMP-1,10.000,1,,\nOther Lamp,lamp-1,11.000,1,,");
    expect(plan.products).toHaveLength(1);
    expect(plan.problems).toEqual([{ line: 3, column: "sku", reason: "bulk.duplicateSku" }]);
  });

  it("refuses a file with no title or no price column at all", () => {
    expect(planUpload("name,stock\nLamp,2").problems[0].reason).toBe("bulk.missingColumns");
    expect(planUpload("").problems[0].reason).toBe("bulk.missingColumns");
  });
});

describe("guessing the department (3.3.5)", () => {
  it("reads the words a shopper would", () => {
    expect(suggestDepartment("Brass Reading Lamp", ["Home & Kitchen", "Electronics"])).toBe("Home & Kitchen");
    expect(suggestDepartment("Wireless Headphones", ["Home & Kitchen", "Electronics"])).toBe("Electronics");
  });

  /* Half this catalog is typed in Arabic, and an importer that only reads
     English auto-categorises half a shop. */
  it("reads an Arabic title too", () => {
    expect(suggestDepartment("سماعات لاسلكية", ["Electronics", "Grocery"])).toBe("Electronics");
    expect(suggestDepartment("قهوة عربية", ["Electronics", "Grocery"])).toBe("Grocery");
  });

  /* Filed under the wrong department is harder to find than filed under none. */
  it("answers null rather than guessing", () => {
    expect(suggestDepartment("Assorted item 45B", ["Electronics", "Grocery"])).toBeNull();
  });

  it("never guesses into a department this shop does not carry", () => {
    expect(suggestDepartment("Wireless Headphones", ["Grocery"])).toBeNull();
  });

  it("leaves what the seller typed alone", () => {
    const plan = planUpload("title,price,category\nWireless Headphones,10.000,Grocery");
    expect(plan.products[0]).toMatchObject({ category: "Grocery", categoryGuessed: false });
    expect(plan.guessed).toBe(0);
  });

  it("fills an empty cell and says it guessed", () => {
    const plan = planUpload("title,price,category\nWireless Headphones,10.000,");
    expect(plan.products[0]).toMatchObject({ category: "Electronics", categoryGuessed: true });
    expect(plan.guessed).toBe(1);
  });
});

describe("the template", () => {
  /* Generated from COLUMNS, so a column added to the importer appears in the
     file a seller downloads rather than in neither. */
  it("round-trips through the importer it came from", () => {
    const plan = planUpload(templateCsv());
    expect(plan.problems).toEqual([]);
    expect(plan.products).toHaveLength(1);
    expect(plan.products[0].category).toBe("Home & Kitchen");
  });
});

describe("the model's second pass", () => {
  it("keeps only lines that were asked about, filed under a department the shop carries", () => {
    expect(departmentsFromModel({ "12": "electronics", "13": "Grocery", "14": "Other", "99": "Beauty", "15": null, "x": "Style" }, [12, 13, 14, 15]))
      .toEqual({ 12: "Electronics", 13: "Grocery" });
    expect(departmentsFromModel(null, [12])).toEqual({});
  });
});
