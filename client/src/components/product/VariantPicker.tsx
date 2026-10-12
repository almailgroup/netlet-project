/**
 * Variants as things you can see, not a dropdown.
 *
 * A colour written in a `<select>` asks the shopper to imagine it. Swatches
 * show it, and picking one swaps the photo — which is the whole point: "what
 * does the charcoal one actually look like" is the question a variant control
 * exists to answer.
 *
 * Options are read from what the merchant configured rather than assumed, so a
 * product with Size and Colour gets two rows and one with neither gets none.
 * The colour row is rendered as swatches only where the value names a colour we
 * can actually paint; anything else falls back to a labelled chip, because a
 * grey square captioned "Oak" is worse than the word "Oak".
 */
import { useTranslation } from "@/hooks/useTranslation";
import { isDefaultVariantTitle } from "@shared/commerce/fromInventory";
import type { Product, ProductVariant } from "@shared/commerce/types";

/**
 * CSS knows these names, so the browser is the colour dictionary rather than a
 * table we would have to keep in step with whatever a merchant types.
 */
const CSS_COLOUR = /^(?:#[0-9a-f]{3,8}|[a-z]+(?:\s[a-z]+)?)$/i;

function swatchColour(value: string): string | null {
  const cleaned = value.trim().toLowerCase();
  if (!CSS_COLOUR.test(cleaned)) return null;
  // Ask the browser: an unknown name leaves the probe's colour untouched.
  if (typeof document === "undefined") return null;
  const probe = document.createElement("span");
  probe.style.color = "rgb(1, 2, 3)";
  probe.style.color = cleaned.replace(/\s+/g, "");
  return probe.style.color === "rgb(1, 2, 3)" ? null : probe.style.color;
}

const COLOUR_OPTION = /colou?r|لون/i;

/**
 * How a product's variants can be chosen.
 *
 * - `options`: every variant carries a value for every option that varies,
 *   and no two share a combination — the swatch and chip rows below.
 * - `titles`: there is more than one variant but the options cannot tell them
 *   apart, which is every product whose variants were named in the editor and
 *   never given option values. Chosen by name. Before this the page drew
 *   nothing, so a shopper could not pick the green one — and the bag, which
 *   names the variant, then said "Green" about a choice nobody made.
 * - `single`: one variant with a real name, shown as a line, so the page says
 *   what the bag will say.
 * - `none`: one variant called "Default", which is no choice at all.
 */
export function choiceMode(product: Product): "options" | "titles" | "single" | "none" {
  const options = product.options.filter(option => option.values.length > 1);
  if (product.variants.length >= 2) {
    const complete = options.length > 0 && product.variants.every(variant =>
      options.every(option => variant.selectedOptions.some(chosen => chosen.name === option.name)));
    const combos = new Set(product.variants.map(variant => options
      .map(option => variant.selectedOptions.find(chosen => chosen.name === option.name)?.value ?? "")
      .join("\u001f")));
    return complete && combos.size === product.variants.length ? "options" : "titles";
  }
  const only = product.variants[0];
  return only && !isDefaultVariantTitle(only.title) ? "single" : "none";
}

export function VariantPicker({ product, selected, onSelect }: {
  product: Product;
  selected: ProductVariant | undefined;
  onSelect: (variant: ProductVariant) => void;
}) {
  const { t } = useTranslation();
  const mode = choiceMode(product);
  if (mode === "none") return null;

  if (mode === "single") {
    return (
      <p className="mt-6 text-xs font-extrabold text-[#0a285a]">
        {t("product.optionLabel")}<span dir="auto" className="ms-1.5 font-semibold ink-muted">{product.variants[0].title}</span>
      </p>
    );
  }

  if (mode === "titles") {
    return (
      <fieldset className="mt-6">
        <legend className="text-xs font-extrabold text-[#0a285a]">
          {t("product.optionLabel")}
          {selected ? <span dir="auto" className="ms-1.5 font-semibold ink-muted">{selected.title}</span> : null}
        </legend>
        <div className="mt-2.5 flex flex-wrap gap-2" role="radiogroup" aria-label={t("product.chooseOption")}>
          {product.variants.map(variant => {
            const active = selected?.id === variant.id;
            return (
              <button
                key={variant.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(variant)}
                className={`pressable min-h-10 rounded-xl border-2 px-3.5 text-[13px] font-bold transition-colors ${active ? "border-[#f2683a] bg-[#fff7e3] text-[#0a285a]" : "border-[#d5dfeb] bg-white text-[#404553] hover:border-[#aac0da] hover:bg-[#f0f2f5]"} ${variant.availableForSale ? "" : "ink-muted line-through"}`}
              >
                <bdi>{variant.title}</bdi>
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }

  // An option with a single value cannot narrow anything, so it is a label
  // rather than a control and does not earn a row of swatches.
  const options = product.options.filter(option => option.values.length > 1);

  /**
   * The variant to move to when one option changes.
   *
   * Keeps every other choice the shopper already made where possible, so
   * switching colour on a Medium does not silently drop them back to Small.
   */
  const variantFor = (optionName: string, value: string) => {
    const wanted = new Map(selected?.selectedOptions.map(o => [o.name, o.value]) ?? []);
    wanted.set(optionName, value);
    const exact = product.variants.find(variant =>
      variant.selectedOptions.every(option => wanted.get(option.name) === option.value));
    // No exact combination exists — honour the option they just touched.
    return exact ?? product.variants.find(variant =>
      variant.selectedOptions.some(option => option.name === optionName && option.value === value));
  };

  return (
    <div className="mt-6 space-y-4">
      {options.map(option => {
        const current = selected?.selectedOptions.find(o => o.name === option.name)?.value;
        const isColour = COLOUR_OPTION.test(option.name);

        return (
          <fieldset key={option.name}>
            <legend className="text-xs font-extrabold text-[#0a285a]">
              {option.name}
              {current ? <span className="ms-1.5 font-semibold ink-muted">{current}</span> : null}
            </legend>
            <div className="mt-2.5 flex flex-wrap gap-2" role="radiogroup" aria-label={t("product.chooseVariant", { option: option.name })}>
              {option.values.map(value => {
                const variant = variantFor(option.name, value);
                const available = Boolean(variant?.availableForSale);
                const active = current === value;
                const colour = isColour ? swatchColour(value) : null;

                return (
                  <button
                    key={value}
                    role="radio"
                    aria-checked={active}
                    aria-label={`${option.name}: ${value}`}
                    title={value}
                    disabled={!variant}
                    onClick={() => variant && onSelect(variant)}
                    className={
                      colour
                        ? `pressable relative grid size-10 place-items-center rounded-full border-2 transition-colors ${active ? "border-[#f2683a]" : "border-[#d5dfeb] hover:border-[#aac0da]"} ${available ? "" : "opacity-40"}`
                        : `pressable min-h-10 rounded-xl border-2 px-3.5 text-[13px] font-bold transition-colors ${active ? "border-[#f2683a] bg-[#fff7e3] text-[#0a285a]" : "border-[#d5dfeb] bg-white text-[#404553] hover:border-[#aac0da] hover:bg-[#f0f2f5]"} ${available ? "" : "ink-muted line-through"}`
                    }
                  >
                    {colour
                      ? <span aria-hidden className="size-7 rounded-full border border-black/10" style={{ backgroundColor: colour }} />
                      : value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * The image that belongs to a variant.
 *
 * The normalized `Product` has no per-variant image, so the
 * variant's own option values are matched against the image alt text the
 * merchant wrote — which is where "Aurora Desk Lamp – Charcoal" lives. No
 * match means no change, which is better than jumping to an unrelated photo.
 */
export function imageIndexForVariant(product: Product, variant: ProductVariant | undefined): number | null {
  if (!variant) return null;
  /* A variant named in the editor has no option values; its name is what the alt text would carry. */
  const named = variant.selectedOptions.length ? [] : isDefaultVariantTitle(variant.title) ? [] : [variant.title];
  const values = [...variant.selectedOptions.map(option => option.value), ...named].map(value => value.toLowerCase()).filter(Boolean);
  if (!values.length) return null;
  const index = product.images.findIndex(image => {
    const alt = image.altText?.toLowerCase();
    return alt ? values.some(value => alt.includes(value)) : false;
  });
  return index === -1 ? null : index;
}
