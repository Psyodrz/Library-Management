const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const db = require("./db");

// Base directory structure
const BASE_UPLOAD_DIR = path.join(__dirname, "public", "uploads");
const BOOKS_DIR = path.join(BASE_UPLOAD_DIR, "books");

// Image sizes
const SIZES = {
  thumbnail: { width: 200, height: 300, quality: 80 },
  medium: { width: 500, height: 750, quality: 85 },
  large: { width: 1000, height: 1500, quality: 90 },
};

// Ensure directories exist
function ensureDirectoriesExist() {
  // Main directories
  [
    BASE_UPLOAD_DIR,
    BOOKS_DIR,
    path.join(BOOKS_DIR, "thumbnails"),
    path.join(BOOKS_DIR, "medium"),
    path.join(BOOKS_DIR, "originals"),
  ].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  });
}

// Create organized subdirectories for a book
function createBookDirectories(bookId, category, author) {
  // Sanitize inputs for directory names
  const sanitizedCategory = (category || "uncategorized")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
  const sanitizedAuthor = (author || "unknown")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();

  const bookDir = path.join(BOOKS_DIR, "by-book", `book_${bookId}`);
  const categoryDir = path.join(BOOKS_DIR, "by-category", sanitizedCategory);
  const authorDir = path.join(BOOKS_DIR, "by-author", sanitizedAuthor);

  // Create directories if they don't exist
  [bookDir, categoryDir, authorDir].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  return { bookDir, categoryDir, authorDir };
}

// Process an image - create different sizes and store in organized directories
async function processImage(file, bookId, metadata = {}) {
  try {
    ensureDirectoriesExist();

    const { originalname, path: tempPath, mimetype, size } = file;
    const fileExtension = path.extname(originalname).toLowerCase();
    const baseFilename = `${Date.now()}-${uuidv4()}`;

    // Get book information
    let bookInfo = { category: "uncategorized", author: "unknown" };
    if (bookId) {
      const [rows] = await db.execute(
        "SELECT category, author FROM books WHERE id = ?",
        [bookId]
      );
      if (rows.length > 0) {
        bookInfo = rows[0];
      }
    }

    // Create directories
    const { bookDir } = createBookDirectories(
      bookId,
      bookInfo.category,
      bookInfo.author
    );

    // Image paths
    const originalPath = path.join(
      bookDir,
      `${baseFilename}_original${fileExtension}`
    );
    const thumbnailPath = path.join(
      BOOKS_DIR,
      "thumbnails",
      `${baseFilename}_thumb${fileExtension}`
    );
    const mediumPath = path.join(
      BOOKS_DIR,
      "medium",
      `${baseFilename}_medium${fileExtension}`
    );

    // Get image dimensions
    const imageInfo = await sharp(tempPath).metadata();

    // Save original
    await fs.promises.copyFile(tempPath, originalPath);

    // Create thumbnail
    await sharp(tempPath)
      .resize(SIZES.thumbnail.width, SIZES.thumbnail.height, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .jpeg({ quality: SIZES.thumbnail.quality })
      .toFile(thumbnailPath);

    // Create medium size
    await sharp(tempPath)
      .resize(SIZES.medium.width, SIZES.medium.height, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .jpeg({ quality: SIZES.medium.quality })
      .toFile(mediumPath);

    // Delete temp file
    fs.unlinkSync(tempPath);

    // Create relative paths for database
    const dbOriginalPath = originalPath
      .replace(path.join(__dirname, "public"), "")
      .replace(/\\/g, "/");
    const dbThumbnailPath = thumbnailPath
      .replace(path.join(__dirname, "public"), "")
      .replace(/\\/g, "/");
    const dbMediumPath = mediumPath
      .replace(path.join(__dirname, "public"), "")
      .replace(/\\/g, "/");

    // Prepare metadata for insertion
    const imageMetadata = {
      book_id: bookId || null,
      image_type: metadata.imageType || "cover",
      file_path: dbOriginalPath,
      thumbnail_path: dbThumbnailPath,
      medium_path: dbMediumPath,
      original_filename: originalname,
      alt_text: metadata.altText || originalname,
      caption: metadata.caption || "",
      copyright: metadata.copyright || "",
      width: imageInfo.width,
      height: imageInfo.height,
      size_bytes: size,
      mime_type: mimetype,
      is_primary: metadata.isPrimary || false,
      display_order: metadata.displayOrder || 0,
    };

    // Insert into database
    const [result] = await db.execute(
      `
      INSERT INTO image_metadata 
      (book_id, image_type, file_path, thumbnail_path, medium_path, 
       original_filename, alt_text, caption, copyright, width, height, 
       size_bytes, mime_type, is_primary, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        imageMetadata.book_id,
        imageMetadata.image_type,
        imageMetadata.file_path,
        imageMetadata.thumbnail_path,
        imageMetadata.medium_path,
        imageMetadata.original_filename,
        imageMetadata.alt_text,
        imageMetadata.caption,
        imageMetadata.copyright,
        imageMetadata.width,
        imageMetadata.height,
        imageMetadata.size_bytes,
        imageMetadata.mime_type,
        imageMetadata.is_primary,
        imageMetadata.display_order,
      ]
    );

    // Update book cover if this is a primary cover image
    if (
      bookId &&
      imageMetadata.image_type === "cover" &&
      imageMetadata.is_primary
    ) {
      await db.execute("UPDATE books SET imageUrl = ? WHERE id = ?", [
        imageMetadata.medium_path,
        bookId,
      ]);
    }

    return {
      id: result.insertId,
      ...imageMetadata,
      paths: {
        original: dbOriginalPath,
        thumbnail: dbThumbnailPath,
        medium: dbMediumPath,
      },
    };
  } catch (error) {
    console.error("Error processing image:", error);
    throw error;
  }
}

// Get images for a book
async function getBookImages(bookId, type = null) {
  try {
    let query = "SELECT * FROM image_metadata WHERE book_id = ?";
    const params = [bookId];

    if (type) {
      query += " AND image_type = ?";
      params.push(type);
    }

    query += " ORDER BY is_primary DESC, display_order ASC";

    const [rows] = await db.execute(query, params);
    return rows;
  } catch (error) {
    console.error("Error fetching book images:", error);
    throw error;
  }
}

// Update image metadata
async function updateImageMetadata(imageId, metadata) {
  try {
    const updates = [];
    const params = [];

    // Build dynamic update query
    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        params.push(value);
      }
    });

    if (updates.length === 0)
      return { success: false, message: "No fields to update" };

    // Add image ID
    params.push(imageId);

    // Execute update
    await db.execute(
      `UPDATE image_metadata SET ${updates.join(", ")} WHERE id = ?`,
      params
    );

    // Check if primary status changed
    if (metadata.is_primary) {
      const [imageData] = await db.execute(
        "SELECT book_id, file_path FROM image_metadata WHERE id = ?",
        [imageId]
      );
      if (imageData.length > 0) {
        // Update other images to not be primary
        await db.execute(
          'UPDATE image_metadata SET is_primary = FALSE WHERE book_id = ? AND id != ? AND image_type = "cover"',
          [imageData[0].book_id, imageId]
        );

        // Update book cover
        await db.execute("UPDATE books SET imageUrl = ? WHERE id = ?", [
          imageData[0].file_path,
          imageData[0].book_id,
        ]);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error updating image metadata:", error);
    throw error;
  }
}

// Delete an image
async function deleteImage(imageId) {
  try {
    // Get image data
    const [imageData] = await db.execute(
      "SELECT * FROM image_metadata WHERE id = ?",
      [imageId]
    );
    if (imageData.length === 0) {
      return { success: false, message: "Image not found" };
    }

    const image = imageData[0];

    // Delete files
    const filePaths = [
      path.join(__dirname, "public", image.file_path),
      path.join(__dirname, "public", image.thumbnail_path),
      path.join(__dirname, "public", image.medium_path),
    ];

    // Delete each file
    filePaths.forEach((filePath) => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    // Delete from database
    await db.execute("DELETE FROM image_metadata WHERE id = ?", [imageId]);

    // If this was a primary cover, update the book
    if (image.is_primary && image.image_type === "cover") {
      // Find next available cover
      const [nextCover] = await db.execute(
        'SELECT * FROM image_metadata WHERE book_id = ? AND image_type = "cover" ORDER BY display_order ASC LIMIT 1',
        [image.book_id]
      );

      if (nextCover.length > 0) {
        // Set it as primary
        await db.execute(
          "UPDATE image_metadata SET is_primary = TRUE WHERE id = ?",
          [nextCover[0].id]
        );
        // Update book cover
        await db.execute("UPDATE books SET imageUrl = ? WHERE id = ?", [
          nextCover[0].file_path,
          image.book_id,
        ]);
      } else {
        // No covers left, reset to placeholder
        await db.execute("UPDATE books SET imageUrl = NULL WHERE id = ?", [
          image.book_id,
        ]);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error deleting image:", error);
    throw error;
  }
}

module.exports = {
  processImage,
  getBookImages,
  updateImageMetadata,
  deleteImage,
  ensureDirectoriesExist,
};
