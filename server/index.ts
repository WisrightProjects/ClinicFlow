import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { createServer } from "net";
import { storage } from "./storage";
import { paymentService } from "./services/payment";

// Function to find an available port
async function findAvailablePort(startPort: number): Promise<number> {
  const isPortAvailable = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = createServer()
        .listen(port, "127.0.0.1")
        .once("error", () => {
          resolve(false);
        })
        .once("listening", () => {
          server.close();
          resolve(true);
        });
    });
  };

  let port = startPort;
  while (!(await isPortAvailable(port))) {
    port++;
  }
  return port;
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Try to use port 5000, but find next available if taken
const desiredPort = process.env.PORT ? parseInt(process.env.PORT) : 5001;
const port = await findAvailablePort(desiredPort);
  
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}${port !== desiredPort ? ` (fallback from ${desiredPort})` : ''}`);
  });

  // Periodically expire stale walk-in token reservations (every 60 seconds)
  setInterval(async () => {
    try {
      await storage.expireStaleReservations();
    } catch (err) {
      console.error('Error expiring stale reservations:', err);
    }

    // Backstop for online payments whose callbacks never arrived — a patient who paid by
    // UPI and closed the app, or a webhook that was lost. Without this, money is
    // collected and nothing is given back. No-op unless the live gateway is configured.
    try {
      await paymentService.sweepStaleHdfcOrders();
    } catch (err) {
      console.error('Error sweeping stale gateway orders:', err);
    }
  }, 60_000);
})();
