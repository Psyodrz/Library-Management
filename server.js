const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const db = require("./db");
const routes = require("./routes");
const imageProcessor = require("./imageProcessor");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const PORT = process.env.PORT || 3001;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Socket.IO connection handler
io.on("connection", (socket) => {
  console.log("New client connected");

  // Authenticate user (optional)
  socket.on("authenticate", (userData) => {
    if (userData && userData.id) {
      socket.userId = userData.id;
      socket.userRole = userData.role;
      socket.join(`user-${userData.id}`); // Create a room for this user

      if (userData.role === "admin") {
        socket.join("admins"); // Add to admin room
      }
      console.log(`User authenticated: ${userData.id}, role: ${userData.role}`);
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Make io accessible to routes
app.set("io", io);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "public", "uploads", "temp");
    console.log("Temp upload directory:", uploadDir);

    // Create the directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      console.log("Creating temp upload directory");
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log("Directory created successfully");
      } catch (err) {
        console.error("Error creating directory:", err);
      }
    } else {
      console.log("Temp upload directory already exists");
    }

    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Preserve original filename with timestamp to avoid collisions
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const filename = uniqueSuffix + ext;
    console.log("Generated filename:", filename);
    cb(null, filename);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max size
  fileFilter: function (req, file, cb) {
    // Accept only images
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif|svg|webp)$/i)) {
      return cb(new Error("Only image files are allowed!"), false);
    }
    cb(null, true);
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message || "An unexpected error occurred",
  });
});

// Database connection check middleware
const checkDatabaseConnection = async (req, res, next) => {
  try {
    // Try to get a connection from the pool
    const connection = await db.getConnection();
    // If successful, release it immediately
    connection.release();
    next();
  } catch (error) {
    console.error("Database connection error in middleware:", error);
    return res.status(503).json({
      error: "Database Connection Error",
      message:
        "The server is currently unable to handle the request due to database connectivity issues",
    });
  }
};

// Apply database check to API routes only
app.use("/api", checkDatabaseConnection);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "public")));

// Make sure image directories exist
imageProcessor.ensureDirectoriesExist();

// API Routes
app.use("/api", routes);

// Simple test endpoint to verify API routing
app.get("/api/test", (req, res) => {
  res.json({
    message: "API test endpoint working correctly",
    time: new Date().toISOString(),
  });
});

// Enhanced upload endpoint
app.post("/api/upload", upload.single("bookImage"), async (req, res) => {
  try {
    console.log("Upload request received");
    if (!req.file) {
      console.log("No file in request");
      return res.status(400).json({ message: "No file uploaded" });
    }
    console.log("File uploaded:", req.file);

    // Get book ID and metadata from request
    const bookId = req.query.bookId || null;
    const metadata = {
      imageType: req.body.imageType || "cover",
      altText: req.body.altText || req.file.originalname,
      caption: req.body.caption || "",
      copyright: req.body.copyright || "",
      isPrimary:
        req.body.isPrimary === "true" || req.body.isPrimary === true || false,
      displayOrder: parseInt(req.body.displayOrder || 0),
    };

    // Process image and save to organized directories
    const processedImage = await imageProcessor.processImage(
      req.file,
      bookId,
      metadata
    );

    res.json({
      id: processedImage.id,
      bookId: processedImage.book_id,
      filePath: processedImage.file_path,
      thumbnailPath: processedImage.thumbnail_path,
      mediumPath: processedImage.medium_path,
      isPrimary: processedImage.is_primary,
      absolutePath: `${req.protocol}://${req.get("host")}${
        processedImage.medium_path
      }`,
      message: "Image uploaded and processed successfully",
    });
  } catch (error) {
    console.error("Upload error:", error);
    res
      .status(500)
      .json({ message: "File upload failed", error: error.message });
  }
});

// New endpoint for getting book images
app.get("/api/images/book/:bookId", async (req, res) => {
  try {
    const bookId = req.params.bookId;
    const type = req.query.type; // Optional: filter by image type

    const images = await imageProcessor.getBookImages(bookId, type);

    // Add absolute URLs
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const imageData = images.map((img) => ({
      ...img,
      urls: {
        thumbnail: `${baseUrl}${img.thumbnail_path}`,
        medium: `${baseUrl}${img.medium_path}`,
        original: `${baseUrl}${img.file_path}`,
      },
    }));

    res.json(imageData);
  } catch (error) {
    console.error("Error fetching images:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch images", error: error.message });
  }
});

// Update image metadata
app.put("/api/images/:imageId", async (req, res) => {
  try {
    const imageId = req.params.imageId;
    const metadata = req.body;

    // Process metadata update
    const result = await imageProcessor.updateImageMetadata(imageId, metadata);

    res.json(result);
  } catch (error) {
    console.error("Error updating image:", error);
    res
      .status(500)
      .json({ message: "Failed to update image", error: error.message });
  }
});

// Delete image
app.delete("/api/images/:imageId", async (req, res) => {
  try {
    const imageId = req.params.imageId;

    // Delete image
    const result = await imageProcessor.deleteImage(imageId);

    res.json(result);
  } catch (error) {
    console.error("Error deleting image:", error);
    res
      .status(500)
      .json({ message: "Failed to delete image", error: error.message });
  }
});

// Serve the main HTML file for any other route (KEEP THIS LAST!)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start the server using the HTTP server
server.listen(PORT, () => {
  console.log(`Server running on port http://localhost:${PORT}`);
});
