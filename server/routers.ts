import { authRouter } from "./routers/auth.js";
import { router } from "./_core/trpc.js";
import { commerceRouter } from "./routers/commerce.js";
import { customerRouter } from "./routers/customer.js";
import { inventoryRouter } from "./routers/inventory.js";
import { ordersRouter } from "./routers/orders.js";
import { searchRouter } from "./routers/search.js";

export const appRouter = router({
  auth: authRouter,
  commerce: commerceRouter,
  customer: customerRouter,
  inventory: inventoryRouter,
  orders: ordersRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;
