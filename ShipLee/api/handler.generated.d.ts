/** Types for the bundle `pnpm build` writes, which is not committed. */
import type { IncomingMessage, ServerResponse } from "node:http";

declare const handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export default handler;
