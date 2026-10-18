import { adsRouter } from "./ads.js";
import { mediaRouter } from "./media.js";
import { subscriptionsRouter } from "./subscriptions.js";
import { supportRouter } from "./support.js";
import { notificationsRouter } from "./notifications.js";
import { tryOnRouter } from "./tryOn.js";
import { fulfilmentRouter } from "./fulfilment.js";
import { membershipRouter } from "./membership.js";
import { affiliatesRouter } from "./affiliates.js";
import { authRouter } from "./auth.js";
import { router } from "../core/trpc.js";
import { commerceRouter } from "./commerce.js";
import { customerRouter } from "./customer.js";
import { dispatchRouter } from "./dispatch.js";
import { featuresRouter } from "./features.js";
import { invoicesRouter } from "./invoices.js";
import { chatRouter } from "./chat.js";
import { returnsRouter } from "./returns.js";
import { inventoryRouter } from "./inventory.js";
import { offersRouter } from "./offers.js";
import { ordersRouter } from "./orders.js";
import { recommendationsRouter } from "./recommendations.js";
import { rewardsRouter } from "./rewards.js";
import { helpRouter } from "./help.js";
import { financeRouter } from "./finance.js";
import { reviewsRouter } from "./reviews.js";
import { searchRouter } from "./search.js";
import { togetherRouter } from "./together.js";
import { wishlistsRouter } from "./wishlists.js";
import { mapsRouter } from "./maps.js";
import { aiRouter } from "./ai.js";

export const appRouter = router({
  ads: adsRouter,
  media: mediaRouter,
  subscriptions: subscriptionsRouter,
  support: supportRouter,
  notifications: notificationsRouter,
  tryOn: tryOnRouter,
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
  help: helpRouter,
  finance: financeRouter,
  reviews: reviewsRouter,
  search: searchRouter,
  together: togetherRouter,
  wishlists: wishlistsRouter,
  maps: mapsRouter,
  ai: aiRouter,
});

export type AppRouter = typeof appRouter;
