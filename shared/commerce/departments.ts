/**
 * NetLet's departments.
 *
 * One list, in `shared` rather than in the seed script, because two things
 * have to agree about it and they live on opposite sides of the app: the
 * client turns a department name into a URL with `categorySlug`, and the
 * database stores a slug that the category page looks up. If those two ever
 * disagree, every department link lands on an empty page — so the slug is
 * written here once and `departments.test.ts` proves it is the slug the
 * client would have produced.
 *
 * "All" is deliberately absent. It is the absence of a filter rather than a
 * department, and a category row for it would be a department containing
 * everything.
 */

export type Department = {
  slug: string;
  name: string;
  nameAr: string;
  position: number;
};

export const DEPARTMENTS: Department[] = [
  { slug: "electronics", name: "Electronics", nameAr: "إلكترونيات", position: 1 },
  { slug: "home-and-kitchen", name: "Home & Kitchen", nameAr: "المنزل والمطبخ", position: 2 },
  { slug: "beauty", name: "Beauty", nameAr: "الجمال", position: 3 },
  { slug: "style", name: "Style", nameAr: "الأزياء", position: 4 },
  { slug: "grocery", name: "Grocery", nameAr: "البقالة", position: 5 },
];
