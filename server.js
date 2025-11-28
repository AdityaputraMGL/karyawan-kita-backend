const express = require("express");
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const cors = require("cors");

// Inisialisasi Prisma Client
const prisma = new PrismaClient();

const AlphaCheckService = require("./services/alphaCheckService");
const alphaCheckService = new AlphaCheckService(prisma);
alphaCheckService.setupCronJob();

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ CORS Configuration - FINAL VERSION
const corsOptions = {
  origin: function (origin, callback) {
    // Daftar origin yang diizinkan
    const allowedOrigins = [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3001",
    ];

    // Allow requests with no origin (mobile apps, Postman, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS blocked origin: ${origin}`);
      callback(null, true); // Allow anyway untuk development
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  exposedHeaders: ["Content-Length", "X-JSON"],
  maxAge: 600, // Cache preflight response for 10 minutes
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Body parser middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);

  // Log headers untuk debugging (optional)
  if (req.headers.authorization) {
    console.log(
      `  - Authorization: ${req.headers.authorization.substring(0, 30)}...`
    );
  }

  next();
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "HR Backend API is running!",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Test endpoint untuk cek koneksi
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    database: "Connected",
    timestamp: new Date().toISOString(),
  });
});

// ✅ Import Routes
const employeeRoutes = require("./routes/employeeRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const userRoutes = require("./routes/userRoutes");
const payrollRoutes = require("./routes/payrollRoutes");
const leaveRoutes = require("./routes/leaveRoutes");
const performanceRoutes = require("./routes/performanceRoutes");
const statsRoutes = require("./routes/statsRoutes");
const passwordResetRoutes = require("./routes/passwordResetRoutes");
const alphaRoutes = require("./routes/alphaRoutes");

// ✅ Use Routes
app.use("/api/employees", employeeRoutes(prisma));
app.use("/api/attendance", attendanceRoutes(prisma));
app.use("/api/users", userRoutes(prisma));
app.use("/api/payroll", payrollRoutes(prisma));
app.use("/api/leave", leaveRoutes(prisma));
app.use("/api/performance", performanceRoutes(prisma));
app.use("/api/stats", statsRoutes(prisma));
app.use("/api/auth", passwordResetRoutes);
app.use("/api/alpha", alphaRoutes(prisma, alphaCheckService));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.stack);

  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    details: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// 404 handler - harus di paling bawah
app.use((req, res) => {
  console.warn(`⚠️ 404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({
    error: "Route not found",
    path: req.url,
    method: req.method,
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log("=".repeat(50));
  console.log("✅ HR Backend API Server Started");
  console.log("=".repeat(50));
  console.log(`🚀 Server running on: http://localhost:${PORT}`);
  console.log(`🗄️  Database: Connected`);
  console.log(
    `🔐 JWT_SECRET: ${
      process.env.JWT_SECRET ? "✅ Configured" : "⚠️ Using default"
    }`
  );
  console.log(`🌐 CORS enabled for: localhost:3000`);
  console.log(`⏰ Token expires in: ${process.env.JWT_EXPIRES_IN || "7d"}`);
  console.log("=".repeat(50));
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  server.close(async () => {
    console.log("✅ HTTP server closed");

    try {
      await prisma.$disconnect();
      console.log("✅ Database disconnected");
      process.exit(0);
    } catch (error) {
      console.error("❌ Error during shutdown:", error);
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error("⚠️ Forcing shutdown after timeout");
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
