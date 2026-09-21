import { authRouter } from "./routers/auth.js";
import { router } from "./_core/trpc.js";
import { commerceRouter } from "./routers/commerce.js";
import { customerRouter } from "./routers/customer.js";
import { inventoryRouter } from "./routers/inventory.js";
import { ordersRouter } from "./routers/orders.js";
import { recommendationsRouter } from "./routers/recommendations.js";
import { reviewsRouter } from "./routers/reviews.js";
import { searchRouter } from "./routers/search.js";
import { togetherRouter } from "./routers/together.js";
import { wishlistsRouter } from "./routers/wishlists.js";

export const appRouter = router({
  auth: authRouter,
  commerce: commerceRouter,
  customer: customerRouter,
  inventory: inventoryRouter,
  orders: ordersRouter,
  recommendations: recommendationsRouter,
  reviews: reviewsRouter,
  search: searchRouter,
  together: togetherRouter,
  wishlists: wishlistsRouter,
});

export type AppRouter = typeof appRouter;
