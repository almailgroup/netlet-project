import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../../Backend/src/routes";

export const trpc = createTRPCReact<AppRouter>();
