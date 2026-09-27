import { splitBundlePrice, chargedTotal } from "../shared/commerce/bundles.js";
const members = [
  { variantId: 1, productId: 1, vendorId: 1, vendorName: "A", productTitle: "Lamp", variantTitle: null, unitPrice: "24.375", quantity: 3 },
  { variantId: 2, productId: 2, vendorId: 2, vendorName: "B", productTitle: "Kettle", variantTitle: null, unitPrice: "11.250", quantity: 1 },
];
const priced = splitBundlePrice({ bundlePrice: "70.001", members } as never);
console.log("seller set : 70.001");
console.log("parts      :", chargedTotal(priced), "   (so the fixture does exercise the rounding)");
console.log(priced.map(p => `${p.productTitle} x${p.quantity} @ ${p.bundleUnitPrice} = ${p.lineTotal}`).join("\n"));
