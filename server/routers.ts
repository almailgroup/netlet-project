import { adsRouter } from "./routers/ads.js";
import { mediaRouter } from "./routers/media.js";
import { subscriptionsRouter } from "./routers/subscriptions.js";
import { supportRouter } from "./routers/support.js";
import { fulfilmentRouter } from "./routers/fulfilment.js";
import { membershipRouter } from "./routers/membership.js";
import { affiliatesRouter } from "./routers/affiliates.js";
import { authRouter } from "./routers/auth.js";
import { router } from "./_core/trpc.js";
import { commerceRouter } from "./routers/commerce.js";
import { customerRouter } from "./routers/customer.js";
import { dispatchRouter } from "./routers/dispatch.js";
import { featuresRouter } from "./routers/features.js";
import { invoicesRouter } from "./routers/invoices.js";
import { chatRouter } from "./routers/chat.js";
import { returnsRouter } from "./routers/returns.js";
import { inventoryRouter } from "./routers/inventory.js";
import { offersRouter } from "./routers/offers.js";
import { ordersRouter } from "./routers/orders.js";
import { recommendationsRouter } from "./routers/recommendations.js";
import { rewardsRouter } from "./routers/rewards.js";
import { assistantRouter } from "./routers/assistant.js";
import { helpRouter } from "./routers/help.js";
import { financeRouter } from "./routers/finance.js";
import { reviewsRouter } from "./routers/reviews.js";
import { searchRouter } from "./routers/search.js";
import { togetherRouter } from "./routers/together.js";
import { wishlistsRouter } from "./routers/wishlists.js";
import { mapsRouter } from "./routers/maps.js";

export const appRouter = router({
  ads: adsRouter,
  media: mediaRouter,
  subscriptions: subscriptionsRouter,
  support: supportRouter,
  fulfilment: fulfilmentRouter,
  membership: membershipRouter,
  affiliates: affiliatesRouter,
  auth: authRouter,
  commerce: commerceRouter,
  customer: customerRouter,
  dispatch: dispatchRouter,
  features: featuresRouter,
  invoices: invoicesRouter,
  chat: chatRouter,
  returns: returnsRouter,
  inventory: inventoryRouter,
  offers: offersRouter,
  orders: ordersRouter,
  recommendations: recommendationsRouter,
  rewards: rewardsRouter,
  assistant: assistantRouter,
  help: helpRouter,
  finance: financeRouter,
  reviews: reviewsRouter,
  search: searchRouter,
  together: togetherRouter,
  wishlists: wishlistsRouter,
  maps: mapsRouter,
});

export type AppRouter = typeof appRouter;
