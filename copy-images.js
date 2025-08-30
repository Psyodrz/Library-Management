const fs = require("fs");
const path = require("path");

// Function to ensure directory exists
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

// Main function to copy images
function copyImages() {
  try {
    const sourceDir = path.join(__dirname, "contains image");
    const targetDir = path.join(__dirname, "public", "images");

    // Ensure the target directory exists
    ensureDirectoryExists(targetDir);

    // Get all files from source directory
    const files = fs.readdirSync(sourceDir);

    console.log(`Found ${files.length} files in ${sourceDir}`);

    let copied = 0;

    // Copy each image file
    for (const file of files) {
      // Check if it's an image file
      if (!file.match(/\.(jpg|jpeg|png|webp)$/i)) {
        continue;
      }

      const sourcePath = path.join(sourceDir, file);
      const targetPath = path.join(targetDir, file);

      // Skip if file already exists in target directory
      if (fs.existsSync(targetPath)) {
        console.log(`File already exists: ${file}, skipping...`);
        continue;
      }

      // Copy the file
      fs.copyFileSync(sourcePath, targetPath);
      copied++;
      console.log(`Copied: ${file}`);
    }

    console.log(
      `Successfully copied ${copied} image files to public/images directory.`
    );
  } catch (error) {
    console.error("Error copying images:", error);
    process.exit(1);
  }
}

// Run the script
copyImages();
