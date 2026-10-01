import { authRouter } from "./routers/auth.js";
import { router } from "./_core/trpc.js";
import { commerceRouter } from "./routers/commerce.js";
import { customerRouter } from "./routers/customer.js";
import { dispatchRouter } from "./routers/dispatch.js";
import { chatRouter } from "./routers/chat.js";
import { inventoryRouter } from "./routers/inventory.js";
import { offersRouter } from "./routers/offers.js";
import { ordersRouter } from "./routers/orders.js";
import { recommendationsRouter } from "./routers/recommendations.js";
import { rewardsRouter } from "./routers/rewards.js";
import { assistantRouter } from "./routers/assistant.js";
import { financeRouter } from "./routers/finance.js";
import { reviewsRouter } from "./routers/reviews.js";
import { searchRouter } from "./routers/search.js";
import { togetherRouter } from "./routers/together.js";
import { wishlistsRouter } from "./routers/wishlists.js";

export const appRouter = router({
  auth: authRouter,
  commerce: commerceRouter,
  customer: customerRouter,
  dispatch: dispatchRouter,
  chat: chatRouter,
  inventory: inventoryRouter,
  offers: offersRouter,
  orders: ordersRouter,
  recommendations: recommendationsRouter,
  rewards: rewardsRouter,
  assistant: assistantRouter,
  finance: financeRouter,
  reviews: reviewsRouter,
  search: searchRouter,
  together: togetherRouter,
  wishlists: wishlistsRouter,
});

export type AppRouter = typeof appRouter;
