import { authRouter } from "./routers/auth";
import { router } from "./_core/trpc";
import { commerceRouter } from "./routers/commerce";
import { customerRouter } from "./routers/customer";
import { inventoryRouter } from "./routers/inventory";
import { searchRouter } from "./routers/search";

export const appRouter = router({
  auth: authRouter,
  commerce: commerceRouter,
  customer: customerRouter,
  inventory: inventoryRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;
