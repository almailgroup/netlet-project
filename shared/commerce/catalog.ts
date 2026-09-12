import type { Product } from "./types.js";

export type AvailabilityFilter = "all" | "available" | "unavailable";
export type CatalogSort = "catalog" | "price-low" | "price-high" | "offers";

function amount(product: Product) {
  return Number(product.priceRange.min.amount);
}

function available(product: Product) {
  return product.variants.some((variant) => variant.availableForSale);
}

function onOffer(product: Product) {
  return product.variants.some((variant) => variant.compareAtPrice !== null);
}

export function filterAndSortCatalog(products: Product[], options: { availability: AvailabilityFilter; sort: CatalogSort }) {
  const eligible = products.filter((product) => {
    if (options.availability === "available") return available(product);
    if (options.availability === "unavailable") return !available(product);
    return true;
  });

  return eligible.slice().sort((left, right) => {
    if (options.sort === "price-low") return amount(left) - amount(right);
    if (options.sort === "price-high") return amount(right) - amount(left);
    if (options.sort === "offers") {
      const offerDifference = Number(onOffer(right)) - Number(onOffer(left));
      return offerDifference || amount(left) - amount(right);
    }
    return 0;
  });
}
