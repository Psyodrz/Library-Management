const { exec } = require("child_process");

console.log("===== STARTING BOOK IMPORT PROCESS =====");

// First, copy the images to public/images directory
console.log("\n1. Copying images to public/images directory...");
exec("node copy-images.js", (error, stdout, stderr) => {
  if (error) {
    console.error(`Error copying images: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`Error output: ${stderr}`);
  }

  console.log(stdout);

  // After copying images, insert books into database
  console.log("\n2. Inserting books into database...");
  exec("node insert-books.js", (error, stdout, stderr) => {
    if (error) {
      console.error(`Error inserting books: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`Error output: ${stderr}`);
    }

    console.log(stdout);
    console.log("\n===== BOOK IMPORT PROCESS COMPLETED =====");
  });
});
