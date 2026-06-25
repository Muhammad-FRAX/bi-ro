// -------------------------------------------------------------------------------------------------
// ---------------------- [Imports] ----------------------------------------------------------------
import express from "express";
import helmet from "helmet";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";

// -------------------------------------------------------------------------------------------------
// ---------------------- [Configuration] ----------------------------------------------------------
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// -------------------------------------------------------------------------------------------------
// ---------------------- [Security Middleware] ----------------------------------------------------
app.use(cors());
app.use(helmet());

// Global Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limiting each IP to 100 requests per 15 minutes per Window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    error:
      "Too many requests from this source, please try again after 15 minutes",
  },
});

// Auth Rate Limiter
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // Limiting each IP to 5 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    error:
      "Too many login attempts from this source, please try again after 1 minute",
  },
});

// Apply Limiters
app.use(globalLimiter);
app.use("/api/auth", authLimiter);

// -------------------------------------------------------------------------------------------------
// ---------------------- [Core Middleware] --------------------------------------------------------

// Request Logging
app.use((req, res, next) => {
  console.log(` ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Body Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------------------------------------------------------------------------------------
// ---------------------- [Routes] -----------------------------------------------------------------

app.get("/", (req, res) => {
  res.send("Frax is Here!");
});

// Serving frontend files (Production only)
if (process.env.NODE_ENV && process.env.NODE_ENV === "production") {
  const FrontendEntryPointPath = path.join(__dirname, "..", "dist");
  app.use(express.static(FrontendEntryPointPath));

  // Handle all other routes by serving the index.html file
  app.get("*", (req, res) => {
    res.sendFile(path.join(FrontendEntryPointPath, "index.html"));
  });
}

// -------------------------------------------------------------------------------------------------
// ---------------------- [Error Handling] ---------------------------------------------------------
app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
});

// -------------------------------------------------------------------------------------------------
// ---------------------- [Server Start] -----------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
