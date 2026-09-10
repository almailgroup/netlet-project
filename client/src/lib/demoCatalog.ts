/**
 * Static catalog used by the demo build.
 *
 * The live storefront gets its products from NetLet's own inventory through
 * the `commerce.*` tRPC procedures. A demo build runs no server, so this
 * module supplies the same `Product` shapes from `@shared/commerce/types` to
 * keep every screen rendering with realistic data. Nothing here is a real
 * product or price.
 *
 * Images are inline SVG data URIs on purpose: the demo then has no external
 * image host to go down, rate-limit, or need licensing for.
 */
import { DEFAULT_VARIANT_TITLE } from "@shared/commerce/fromInventory";
import type { Product } from "@shared/commerce/types";

const CURRENCY = "KWD";

/**
 * Deterministic placeholder artwork, varied per view.
 *
 * A gallery is only worth building if the thumbnails are distinguishable, so
 * each view gets its own composition rather than the same panel twice: a hero
 * three-quarter, a front elevation, a detail crop, a scale diagram, a lifestyle
 * scene. Inline SVG on purpose — the demo then has no external image host to go
 * down, rate-limit, or need licensing for.
 */
const VIEW_LABELS = [
  "",
  "FRONT VIEW",
  "DETAIL",
  "DIMENSIONS",
  "IN THE ROOM",
  "PORTS &amp; CONNECTIONS",
  "IN THE BOX",
  "SIDE PROFILE",
  "CLOSE UP",
  "SET UP",
];

function placeholderImage(title: string, from: string, to: string, view = 0): string {
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word[0])
    .join("")
    .toUpperCase();
  const label = VIEW_LABELS[view % VIEW_LABELS.length];
  const angle = 20 + view * 26;

  // Each view composes a different arrangement of the same two brand tones, so
  // the rail reads as one product photographed several ways.
  const scenes = [
    `<rect x="150" y="212" width="500" height="376" rx="46" fill="#ffffff" opacity="0.66"/>
     <circle cx="648" cy="160" r="120" fill="#ffffff" opacity="0.22"/>`,
    `<rect x="214" y="180" width="372" height="440" rx="38" fill="#ffffff" opacity="0.6"/>
     <rect x="252" y="222" width="296" height="300" rx="20" fill="#0a285a" opacity="0.10"/>`,
    `<circle cx="400" cy="400" r="238" fill="#ffffff" opacity="0.55"/>
     <circle cx="400" cy="400" r="132" fill="#0a285a" opacity="0.09"/>`,
    `<rect x="176" y="256" width="448" height="288" rx="16" fill="#ffffff" opacity="0.6"/>
     <path d="M176 592 H624 M176 578 V606 M624 578 V606" stroke="#0a285a" stroke-width="6" opacity="0.4" fill="none"/>
     <path d="M120 256 V544 M106 256 H134 M106 544 H134" stroke="#0a285a" stroke-width="6" opacity="0.4" fill="none"/>`,
    `<rect x="0" y="470" width="800" height="330" fill="#0a285a" opacity="0.09"/>
     <rect x="196" y="214" width="408" height="286" rx="26" fill="#ffffff" opacity="0.66"/>
     <rect x="330" y="500" width="140" height="58" rx="10" fill="#0a285a" opacity="0.14"/>`,
    `<rect x="170" y="300" width="460" height="200" rx="26" fill="#ffffff" opacity="0.62"/>
     <g fill="#0a285a" opacity="0.16"><rect x="216" y="358" width="86" height="30" rx="7"/><rect x="330" y="358" width="86" height="30" rx="7"/><rect x="444" y="358" width="86" height="30" rx="7"/><rect x="558" y="358" width="32" height="30" rx="7"/></g>`,
  ];
  const scene = scenes[view % scenes.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <linearGradient id="g" gradientTransform="rotate(${angle})">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="800" fill="url(#g)"/>
  <circle cx="150" cy="662" r="92" fill="#0a285a" opacity="0.05"/>
  ${scene}
  <text x="400" y="428" font-family="Georgia, 'Times New Roman', serif" font-size="118" font-weight="700"
        fill="#0a285a" opacity="0.7" text-anchor="middle">${initials}</text>
  ${label ? `<text x="400" y="712" font-family="system-ui, sans-serif" font-size="26" font-weight="700" letter-spacing="4"
        fill="#0a285a" opacity="0.4" text-anchor="middle">${label}</text>` : ""}
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\n\s*/g, " "))}`;
}

type Seed = {
  handle: string;
  title: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  price: number;
  compareAt?: number;
  soldOut?: boolean;
  options?: { name: string; values: string[] };
  /** Review score out of 5, and how many reviews produced it. */
  rating?: [score: number, count: number];
  /** How many gallery views to generate. Defaults to 2. */
  views?: number;
  palette: [string, string];
};

const SEEDS: Seed[] = [
  {
    handle: "horizon-55-4k-smart-tv",
    title: "Horizon 55\" 4K Smart TV",
    description:
      "Display: 55\" LED, 3840 x 2160, 60Hz\nHDR: HDR10 and HLG\nProcessor: Quad-core 4K upscaler\nSound: 2 x 10W, Dolby Audio\nPorts: 3 x HDMI 2.1, 2 x USB, optical, Ethernet\nSmart: Built-in apps, screen mirroring, voice remote\nStand: Detachable feet, VESA 200 x 200",
    productType: "Electronics",
    vendor: "Horizon Vision",
    tags: ["Television", "4K", "Bestseller", "Express"],
    price: 129.5,
    compareAt: 168,
    rating: [4.6, 312],
    views: 8,
    palette: ["#dbe4ef", "#c2d1e4"],
  },
  {
    handle: "horizon-65-qled-smart-tv",
    title: "Horizon 65\" QLED Smart TV",
    description:
      "Display: 65\" QLED, 3840 x 2160, 120Hz\nHDR: Dolby Vision, HDR10+\nProcessor: Neural 4K engine\nSound: 2.1 channel, 40W, Dolby Atmos\nGaming: ALLM, VRR, 4K at 120Hz over HDMI 2.1\nPorts: 4 x HDMI 2.1, 2 x USB, optical, Ethernet\nStand: Centre pedestal, VESA 400 x 300",
    productType: "Electronics",
    vendor: "Horizon Vision",
    tags: ["Television", "QLED", "New"],
    price: 289,
    compareAt: 349,
    rating: [4.8, 96],
    views: 9,
    palette: ["#d5dced", "#b9c6de"],
  },
  {
    handle: "atlas-32-curved-gaming-monitor",
    title: "Atlas 32\" Curved Gaming Monitor",
    description:
      "Display: 31.5\" VA, 2560 x 1440, 1500R curve\nRefresh: 165Hz, 1ms MPRT\nSync: AMD FreeSync Premium\nColour: 90% DCI-P3, 8-bit + FRC\nPorts: 2 x HDMI 2.0, DisplayPort 1.4, headphone out\nErgonomics: Tilt -5 to 15 degrees, VESA 100 x 100",
    productType: "Electronics",
    vendor: "Atlas Displays",
    tags: ["Monitor", "Gaming", "Bestseller", "Express"],
    price: 96,
    compareAt: 119,
    rating: [4.7, 184],
    views: 7,
    palette: ["#dde3ec", "#c6d0e0"],
  },
  {
    handle: "meridian-soundbar-31",
    title: "Meridian 3.1 Soundbar and Subwoofer",
    description:
      "Channels: 3.1, 320W total\nSubwoofer: Wireless, 6.5\" driver\nFormats: Dolby Atmos, DTS Virtual:X\nConnections: HDMI eARC, optical, Bluetooth 5.3\nModes: Movie, Music, News, Night\nMounting: Wall bracket included",
    productType: "Electronics",
    vendor: "Northbank Audio",
    tags: ["Audio", "Home cinema", "Express"],
    price: 74.5,
    compareAt: 92,
    rating: [4.5, 128],
    views: 6,
    palette: ["#dfe1e6", "#c8ccd6"],
  },
  {
    handle: "cedar-french-door-refrigerator",
    title: "Cedar French Door Refrigerator 520L",
    description:
      "Capacity: 520L total, 348L fridge, 172L freezer\nCooling: Twin inverter, no frost\nEnergy: A++ rating, 42dB\nFeatures: Water dispenser, humidity-controlled crisper, door alarm\nShelving: Four tempered glass shelves, two crispers\nDimensions: 179 x 83 x 71 cm",
    productType: "Home & Kitchen",
    vendor: "Cedar Home",
    tags: ["Appliance", "Kitchen"],
    price: 445,
    compareAt: 520,
    rating: [4.4, 61],
    views: 6,
    palette: ["#e4e6e3", "#cdd1cd"],
  },
  {
    handle: "cedar-front-load-washer-9kg",
    title: "Cedar 9kg Front Load Washing Machine",
    description:
      "Capacity: 9kg\nSpin: 1400rpm\nMotor: Brushless inverter, 10-year warranty\nProgrammes: 15 including quick 15, eco 40-60, steam refresh\nEnergy: A rating\nDimensions: 85 x 60 x 58 cm",
    productType: "Home & Kitchen",
    vendor: "Cedar Home",
    tags: ["Appliance", "Laundry", "Express"],
    price: 218,
    compareAt: 265,
    rating: [4.3, 47],
    views: 5,
    palette: ["#e6e7e4", "#d0d3ce"],
  },
  {
    handle: "vertex-14-ultrabook",
    title: "Vertex 14 Ultrabook 16GB / 512GB",
    description:
      "Display: 14\" 2.8K OLED, 120Hz, 400 nits\nProcessor: 10-core, up to 4.7GHz\nMemory: 16GB LPDDR5\nStorage: 512GB NVMe SSD\nBattery: 70Wh, up to 14 hours\nPorts: 2 x USB-C Thunderbolt, USB-A, HDMI 2.1, headphone\nWeight: 1.29 kg",
    productType: "Electronics",
    vendor: "Vertex Compute",
    tags: ["Laptop", "Workspace", "New", "Express"],
    price: 372,
    compareAt: 429,
    rating: [4.7, 203],
    views: 7,
    palette: ["#e0e3e8", "#c9ced8"],
  },
  {
    handle: "orbit-robot-vacuum-lidar",
    title: "Orbit Robot Vacuum with LiDAR Mapping",
    description:
      "Suction: 5000Pa\nNavigation: LiDAR, multi-floor mapping\nBattery: 5200mAh, up to 180 minutes\nDustbin: 400ml, 300ml water tank\nFeatures: No-go zones, carpet boost, app and voice control\nHeight: 9.6 cm, fits under most furniture",
    productType: "Home & Kitchen",
    vendor: "Orbit Living",
    tags: ["Appliance", "Cleaning", "Bestseller"],
    price: 118,
    compareAt: 149,
    rating: [4.5, 156],
    views: 6,
    palette: ["#e2e4e7", "#cbcfd5"],
  },
  {
    handle: "aurora-desk-lamp",
    title: "Aurora Desk Lamp",
    description:
      "A warm, dimmable desk light with a brushed aluminium arm. Three colour temperatures move it from focused work to a softer evening glow.",
    productType: "Home & Kitchen",
    vendor: "Lumen Studio",
    tags: ["Lighting", "Workspace", "Bestseller", "Express"],
    price: 24.5,
    compareAt: 31,
    options: { name: "Finish", values: ["Brushed Silver", "Matte Black"] },
    rating: [4.6, 58],
    views: 5,
    palette: ["#f5e4c9", "#e7d3b4"],
  },
  {
    handle: "harbour-wireless-earbuds",
    title: "Harbour Wireless Earbuds",
    description:
      "Compact earbuds with active noise cancelling and a pocketable charging case. Around 28 hours of total listening with the case topped up.",
    productType: "Electronics",
    vendor: "Northbank Audio",
    tags: ["Audio", "Bestseller", "New", "Express"],
    price: 39.9,
    compareAt: 52,
    options: { name: "Colour", values: ["Ivory", "Navy", "Graphite"] },
    rating: [4.8, 214],
    views: 6,
    palette: ["#dce5e9", "#c4d3da"],
  },
  {
    handle: "clay-pour-over-set",
    title: "Clay Pour-Over Set",
    description:
      "A stoneware dripper and carafe finished in a soft matte glaze. Brews two cups at a time and sits well on an open shelf.",
    productType: "Home & Kitchen",
    vendor: "Kiln & Co",
    tags: ["Coffee", "Ceramics"],
    price: 18,
    views: 4,
    palette: ["#f0ddd0", "#e2c8b6"],
  },
  {
    handle: "meridian-mechanical-keyboard",
    title: "Meridian Mechanical Keyboard",
    description:
      "A 75% layout with hot-swappable switches, a machined aluminium case, and per-key backlighting. Connects over USB-C or Bluetooth.",
    productType: "Electronics",
    vendor: "Meridian Works",
    tags: ["Workspace", "Bestseller", "Express"],
    price: 62,
    compareAt: 74,
    options: { name: "Switch", values: ["Tactile", "Linear", "Silent"] },
    rating: [5.0, 21],
    views: 7,
    palette: ["#e7edf5", "#ccd9e8"],
  },
  {
    handle: "rosewater-facial-mist",
    title: "Rosewater Facial Mist",
    description:
      "A light hydrating mist of steam-distilled rosewater and glycerin. Settles quickly and layers cleanly under the rest of a routine.",
    productType: "Beauty",
    vendor: "Petal House",
    tags: ["Skincare", "New"],
    price: 8.75,
    rating: [4.7, 96],
    views: 4,
    palette: ["#f6d9d2", "#eec2b8"],
  },
  {
    handle: "linen-weekend-shirt",
    title: "Linen Weekend Shirt",
    description:
      "A relaxed shirt cut from washed European linen, with a soft collar and a slightly dropped shoulder. Gets better with every wash.",
    productType: "Style",
    vendor: "Coastline Supply",
    tags: ["Apparel", "Summer", "Express"],
    price: 29,
    options: { name: "Size", values: ["S", "M", "L", "XL"] },
    rating: [4.3, 12],
    palette: ["#e4dfd0", "#d2ccb9"],
  },
  {
    handle: "cardamom-coffee-beans",
    title: "Cardamom Coffee Beans",
    description:
      "Medium-roast arabica ground with green cardamom, in the Gulf tradition. Sweet and aromatic, whether brewed as qahwa or drip.",
    productType: "Grocery",
    vendor: "Souk Roasters",
    tags: ["Coffee", "Pantry", "Bestseller", "Express"],
    price: 5.25,
    rating: [4.9, 140],
    palette: ["#dce7cf", "#c6d6b6"],
  },
  {
    handle: "terrace-planter-trio",
    title: "Terrace Planter Trio",
    description:
      "Three nesting planters in unglazed terracotta with matching drainage saucers. Sized for herbs on a kitchen windowsill.",
    productType: "Home & Kitchen",
    vendor: "Kiln & Co",
    tags: ["Garden", "Ceramics"],
    price: 14.5,
    compareAt: 19,
    rating: [4.5, 73],
    palette: ["#f0ddd0", "#dcbda9"],
  },
  {
    handle: "atlas-travel-backpack",
    title: "Atlas Travel Backpack",
    description:
      "A 28-litre carry-on backpack in recycled ripstop, with a padded laptop sleeve and a clamshell opening that lies flat.",
    productType: "Style",
    vendor: "Atlas Goods",
    tags: ["Travel", "Bags", "New"],
    price: 45,
    options: { name: "Colour", values: ["Sand", "Olive", "Black"] },
    rating: [4.2, 29],
    palette: ["#dce5e9", "#bfd0d7"],
  },
  {
    handle: "midnight-sleep-balm",
    title: "Midnight Sleep Balm",
    description:
      "A shea and lavender balm for pulse points at the end of the day. Unhurried, faintly herbal, and not at all sweet.",
    productType: "Beauty",
    vendor: "Petal House",
    tags: ["Skincare", "Wellness", "Express"],
    price: 11.4,
    soldOut: true,
    rating: [4.8, 51],
    palette: ["#e6ddef", "#d0c2e0"],
  },
  {
    handle: "orchard-honey-jar",
    title: "Orchard Blossom Honey",
    description:
      "Raw, unfiltered blossom honey in a 450g jar. Thick, slowly crystallising, and gathered from a single season's pressing.",
    productType: "Grocery",
    vendor: "Souk Roasters",
    tags: ["Pantry", "Gift"],
    price: 6.9,
    rating: [4.6, 88],
    palette: ["#f7ecc9", "#ecd79c"],
  },
  {
    handle: "studio-monitor-speakers",
    title: "Studio Monitor Speakers",
    description:
      "A compact pair of near-field monitors with a woven mid driver and a silk dome tweeter. Balanced enough for mixing, easy to live with.",
    productType: "Electronics",
    vendor: "Northbank Audio",
    tags: ["Audio", "Workspace", "Express"],
    price: 118,
    compareAt: 139,
    rating: [5.0, 9],
    palette: ["#e7edf5", "#c9d8e9"],
  },
];

function money(amount: number) {
  return { amount: amount.toFixed(2), currencyCode: CURRENCY };
}

function toProduct(seed: Seed, index: number): Product {
  const optionValues = seed.options?.values ?? [DEFAULT_VARIANT_TITLE];
  const variants = optionValues.map((value, variantIndex) => ({
    id: `demo-variant-${index + 1}-${variantIndex + 1}`,
    title: value,
    // Shaped like a real merchant code so the product page's SKU line is
    // representative; like every other value here, it is invented.
    sku: `NL-${String(index + 1).padStart(3, "0")}-${String(variantIndex + 1).padStart(2, "0")}`,
    price: money(seed.price),
    compareAtPrice: seed.compareAt ? money(seed.compareAt) : null,
    // Sold-out seeds are fully unavailable; otherwise the last variant of a
    // multi-option product is out of stock so the picker's disabled state shows.
    availableForSale: seed.soldOut
      ? false
      : !(optionValues.length > 2 && variantIndex === optionValues.length - 1),
    // A product with no real options carries no option dimensions at
    // all, which is what the inventory mapper produces too.
    selectedOptions: seed.options ? [{ name: seed.options.name, value }] : [],
  }));

  return {
    id: `demo-product-${index + 1}`,
    handle: seed.handle,
    title: seed.title,
    description: seed.description,
    descriptionHtml: `<p>${seed.description}</p>`,
    productType: seed.productType,
    vendor: seed.vendor,
    tags: seed.tags,
    attributes: [
      {
        namespace: "demo",
        key: "origin",
        label: "Ships from",
        value: "Kuwait City",
      },
      {
        namespace: "demo",
        key: "warranty",
        label: "Warranty",
        value: "12 months",
      },
      // Written in the same JSON-in-a-string form a real rating attribute
      // uses, so the demo exercises the same parsing path as a live store.
      ...(seed.rating
        ? [
            {
              namespace: "reviews",
              key: "rating",
              label: "Rating",
              value: `{"scale_min":"1.0","scale_max":"5.0","value":"${seed.rating[0].toFixed(1)}"}`,
            },
            {
              namespace: "reviews",
              key: "rating_count",
              label: "Rating Count",
              value: String(seed.rating[1]),
            },
          ]
        : []),
    ],
    images: Array.from({ length: seed.views ?? 2 }, (_, view) => ({
      url: placeholderImage(seed.title, seed.palette[view % 2], seed.palette[(view + 1) % 2], view),
      altText: view === 0 ? seed.title : `${seed.title} — view ${view + 1}`,
      width: 800,
      height: 800,
    })),
    priceRange: { min: money(seed.price), max: money(seed.price) },
    options: seed.options
      ? [{ name: seed.options.name, values: seed.options.values }]
      : [],
    variants,
  };
}

export const demoCatalog: Product[] = SEEDS.map(toProduct);

export function demoProductByHandle(handle: string): Product | null {
  return demoCatalog.find(product => product.handle === handle) ?? null;
}

export function demoVariant(variantId: string) {
  for (const product of demoCatalog) {
    const variant = product.variants.find(
      candidate => candidate.id === variantId
    );
    if (variant) return { product, variant };
  }
  return null;
}
