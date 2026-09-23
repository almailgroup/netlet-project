/**
 * What a specification row *is*, per department.
 *
 * Requirement 3.1.7's remaining half. `products.attributes` is free-form
 * `jsonb`, which is what let the storefront render whatever a merchant typed —
 * and it is also why the same fact arrives as "RAM", "Ram Size" and
 * "Memory (GB)" from three sellers, so nothing can filter on it and nothing
 * can compare two laptops.
 *
 * ## The decisions
 *
 * **A schema per department, in code, beside the departments themselves.**
 * The alternative is a table and an editor for it, which is a second product
 * to maintain before anybody has asked for one — and departments are already
 * code here for the same reason. When a merchant needs a field that is not
 * listed, they type it, and it still renders: the schema *offers* rows, it
 * does not restrict them.
 *
 * **Free-form rows survive untouched.** A seller who recorded "Warranty note"
 * before this existed keeps it. Anything else would be a schema that deletes
 * merchant data on first save, which is the fastest way to be switched off.
 *
 * **The key is stable and the label is translated.** `ram` is what a filter
 * groups on; "Ram Size" and "الذاكرة" are what people read. Keying on the
 * English label — which is what the free-form rows effectively do — is why
 * one capital letter splits a facet in two.
 *
 * **Units belong to the field, not to the value.** A seller typing "16 GB"
 * and another typing "16" is the same split again. The unit is printed beside
 * the value, so both record `16`.
 */

/** One row a department expects. */
export type AttributeField = {
  /** Stable, lower-case, what a facet groups on. Never shown. */
  key: string;
  label: string;
  labelAr: string;
  /** Printed after the value. The seller records the number alone. */
  unit?: string;
  /** When the answer is one of a few, so two sellers cannot spell it apart. */
  options?: string[];
};

/**
 * The rows each department expects, by slug.
 *
 * Deliberately short. A schema that asks for twenty fields is one sellers
 * abandon halfway, and every unanswered row is a blank on a product page.
 * These are the ones a shopper actually compares on.
 */
export const ATTRIBUTE_SCHEMA: Record<string, AttributeField[]> = {
  electronics: [
    { key: "brand", label: "Brand", labelAr: "العلامة التجارية" },
    { key: "model", label: "Model", labelAr: "الطراز" },
    { key: "ram", label: "Memory", labelAr: "الذاكرة", unit: "GB" },
    { key: "storage", label: "Storage", labelAr: "السعة التخزينية", unit: "GB" },
    { key: "warranty", label: "Warranty", labelAr: "الضمان" },
  ],
  "home-and-kitchen": [
    { key: "brand", label: "Brand", labelAr: "العلامة التجارية" },
    { key: "material", label: "Material", labelAr: "الخامة" },
    { key: "capacity", label: "Capacity", labelAr: "السعة", unit: "L" },
    { key: "power", label: "Power", labelAr: "القدرة", unit: "W" },
  ],
  beauty: [
    { key: "brand", label: "Brand", labelAr: "العلامة التجارية" },
    { key: "volume", label: "Volume", labelAr: "الحجم", unit: "ml" },
    { key: "skintype", label: "Skin type", labelAr: "نوع البشرة" },
  ],
  style: [
    { key: "brand", label: "Brand", labelAr: "العلامة التجارية" },
    { key: "material", label: "Material", labelAr: "الخامة" },
    { key: "fit", label: "Fit", labelAr: "القَصّة", options: ["Regular", "Slim", "Relaxed", "Oversized"] },
  ],
  grocery: [
    { key: "brand", label: "Brand", labelAr: "العلامة التجارية" },
    { key: "origin", label: "Country of origin", labelAr: "بلد المنشأ" },
    { key: "storage", label: "Storage", labelAr: "طريقة الحفظ", options: ["Ambient", "Chilled", "Frozen"] },
  ],
};

/** The namespace a schema row lives in, so it cannot collide with the score. */
export const SPEC_NAMESPACE = "spec";

export type Attribute = { namespace: string; key: string; label: string; value: string };

/** The rows this department expects. Empty for one with no schema, which is fine. */
export function fieldsFor(departmentSlug: string | null | undefined): AttributeField[] {
  if (!departmentSlug) return [];
  return ATTRIBUTE_SCHEMA[departmentSlug] ?? [];
}

/** What the seller recorded for one schema field, or "". */
export function valueOf(attributes: Attribute[], key: string): string {
  return attributes.find(row => row.namespace === SPEC_NAMESPACE && row.key === key)?.value ?? "";
}

/**
 * Rows that are not part of this department's schema.
 *
 * What a seller typed before the schema existed, or needed and the schema did
 * not offer. They are kept and shown: a schema that deletes merchant data on
 * first save is one nobody uses twice. The review score is excluded — it lives
 * in the same column and is not a specification.
 */
export function freeFormRows(attributes: Attribute[], departmentSlug: string | null | undefined): Attribute[] {
  const known = new Set(fieldsFor(departmentSlug).map(field => field.key));
  return attributes.filter(row =>
    row.namespace !== "reviews" && !(row.namespace === SPEC_NAMESPACE && known.has(row.key)));
}

/**
 * Write the schema values back, keeping everything else exactly as it was.
 *
 * A blank clears the row rather than storing an empty string: "" renders as a
 * label with nothing after it, which reads as a shop that lost the value
 * rather than one that never had it.
 */
export function mergeAttributes(
  attributes: Attribute[],
  departmentSlug: string | null | undefined,
  values: Record<string, string>,
): Attribute[] {
  const fields = fieldsFor(departmentSlug);
  const rest = freeFormRows(attributes, departmentSlug);
  const reviews = attributes.filter(row => row.namespace === "reviews");

  const filled = fields
    .filter(field => (values[field.key] ?? "").trim() !== "")
    .map(field => ({
      namespace: SPEC_NAMESPACE,
      key: field.key,
      /* The English label is stored beside the key so an older reader that
         knows nothing of the schema still has words to print. The key is what
         anything comparing two products groups on. */
      label: field.label,
      value: values[field.key].trim(),
    }));

  return [...reviews, ...filled, ...rest];
}

/** The unit to print after a value, if the field declares one. */
export function unitFor(departmentSlug: string | null | undefined, key: string): string | null {
  return fieldsFor(departmentSlug).find(field => field.key === key)?.unit ?? null;
}
