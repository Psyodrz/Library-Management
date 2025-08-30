/**
 * Migrator Script for Book Images
 *
 * This script migrates existing book images to the new image management system.
 * It processes images from the old location, creates thumbnails and medium sizes,
 * and updates the database with new metadata.
 */

const fs = require("fs");
const path = require("path");
const db = require("./db");
const sharp = require("sharp");
const imageProcessor = require("./imageProcessor");

// Path to old images
const OLD_IMAGES_DIR = path.join(__dirname, "public", "uploads", "books");
// Temporary location for processing
const TEMP_DIR = path.join(__dirname, "public", "uploads", "temp");

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Main migration function
async function migrateImages() {
  console.log("Starting image migration...");

  try {
    // Get all books from database
    const [books] = await db.execute(
      "SELECT id, title, author, category, imageUrl FROM books"
    );
    console.log(`Found ${books.length} books to process`);

    // Counters for reporting
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    // Process each book
    for (const book of books) {
      try {
        // Skip books without images
        if (!book.imageUrl || book.imageUrl.includes("placeholder")) {
          console.log(
            `Skipping book ${book.id} (${book.title}) - No image or placeholder`
          );
          skipped++;
          continue;
        }

        // Skip books with already processed images (check for _thumb, _medium, etc.)
        if (
          book.imageUrl.includes("_thumb") ||
          book.imageUrl.includes("_medium") ||
          book.imageUrl.includes("_original")
        ) {
          console.log(
            `Skipping book ${book.id} (${book.title}) - Already using new image format`
          );
          skipped++;
          continue;
        }

        console.log(`Processing book ${book.id}: ${book.title}`);

        // Get the image path
        const imagePath = book.imageUrl.startsWith("/")
          ? path.join(__dirname, "public", book.imageUrl)
          : path.join(__dirname, "public", "/", book.imageUrl);

        // Check if file exists
        if (!fs.existsSync(imagePath)) {
          console.log(`  - Image not found at ${imagePath}`);
          skipped++;
          continue;
        }

        // Create a temporary file object that mimics multer's file object
        const filename = path.basename(imagePath);
        const tempPath = path.join(TEMP_DIR, filename);

        // Copy to temp directory
        await fs.promises.copyFile(imagePath, tempPath);

        // Get file stats
        const stats = await fs.promises.stat(imagePath);

        // Create file object
        const fileObj = {
          originalname: filename,
          path: tempPath,
          size: stats.size,
          mimetype: getMimeType(filename),
        };

        // Process image with our image processor
        const imageMetadata = {
          imageType: "cover",
          altText: `Cover for ${book.title}`,
          caption: `Cover image for ${book.title} by ${book.author}`,
          copyright: "",
          isPrimary: true,
          displayOrder: 0,
        };

        const result = await imageProcessor.processImage(
          fileObj,
          book.id,
          imageMetadata
        );
        console.log(
          `  - Processed image, created thumbnails and saved metadata`
        );

        processed++;
      } catch (error) {
        console.error(
          `Error processing book ${book.id} (${book.title}):`,
          error
        );
        failed++;
      }
    }

    console.log("\nMigration completed:");
    console.log(`- ${processed} images processed successfully`);
    console.log(`- ${skipped} images skipped`);
    console.log(`- ${failed} images failed`);
  } catch (error) {
    console.error("Migration failed:", error);
  }
}

// Helper to determine MIME type from filename
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

// Run the migration
(async function () {
  try {
    // Ensure database is initialized
    await db.connect();
    await migrateImages();
    process.exit(0);
  } catch (error) {
    console.error("Error running migration:", error);
    process.exit(1);
  }
})();
