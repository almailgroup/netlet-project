import "dotenv/config";
import { createServer } from "http";
import net from "net";
import { createApp } from "./app.js";
import { serveStatic, setupVite } from "./vite.js";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = createApp();
  const server = createServer(app);

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = Number.parseInt(process.env.PORT || "3000", 10);

  // Scanning for a free port is a development convenience. In production the
  // port is a contract: the tunnel or reverse proxy in front of this process is
  // pointed at exactly one. Drifting to the next free port there would take the
  // storefront off the internet while leaving a healthy-looking process behind,
  // which is the worst kind of outage to diagnose. Fail loudly instead.
  const isDevelopment = process.env.NODE_ENV === "development";
  const port = isDevelopment ? await findAvailablePort(preferredPort) : preferredPort;

  if (isDevelopment && port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE") throw error;
    console.error(
      `Port ${port} is already in use. Stop whatever is holding it, or set PORT to a free one.`
    );
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
