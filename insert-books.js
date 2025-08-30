const fs = require("fs");
const path = require("path");
const db = require("./db");

// Function to convert image filename to book title with proper capitalization
function formatBookTitle(filename) {
  // Remove extension and convert to title case
  const title = filename
    .replace(/\.(jpg|png|webp)$/, "")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return title;
}

// Function to generate random page count between 150 and 500
function generatePageCount() {
  return Math.floor(Math.random() * (500 - 150 + 1)) + 150;
}

// Function to generate a random year between 1990 and 2023
function generatePublicationYear() {
  return Math.floor(Math.random() * (2023 - 1990 + 1)) + 1990;
}

// Function to generate an ISBN-13
function generateISBN() {
  let isbn = "978";
  for (let i = 0; i < 10; i++) {
    isbn += Math.floor(Math.random() * 10);
  }
  return isbn;
}

// Generate a random author name from a predefined list
function generateAuthor() {
  const authors = [
    "John Smith",
    "Emily Johnson",
    "Michael Brown",
    "Sarah Davis",
    "David Wilson",
    "Jennifer Martinez",
    "Robert Taylor",
    "Lisa Anderson",
    "James Thomas",
    "Patricia Moore",
    "Richard Jackson",
    "Linda White",
    "Charles Harris",
    "Barbara Lewis",
    "Joseph Clark",
    "Susan Hall",
  ];
  return authors[Math.floor(Math.random() * authors.length)];
}

// Generate a category based on the book title or random
function generateCategory(title) {
  // Common categories
  const categories = [
    "Fiction",
    "Non-Fiction",
    "Mystery",
    "Self-Help",
    "Romance",
    "Science Fiction",
    "Fantasy",
    "Biography",
    "History",
    "Business",
  ];

  // Try to determine category from title
  const lowerTitle = title.toLowerCase();

  if (lowerTitle.includes("think") || lowerTitle.includes("ikigai")) {
    return "Self-Help";
  } else if (lowerTitle.includes("paradox") || lowerTitle.includes("truth")) {
    return "Non-Fiction";
  } else if (
    lowerTitle.includes("maze") ||
    lowerTitle.includes("curse") ||
    lowerTitle.includes("bosses")
  ) {
    return "Fantasy";
  } else if (lowerTitle.includes("winter") || lowerTitle.includes("door")) {
    return "Fiction";
  } else if (lowerTitle.includes("cairo")) {
    return "History";
  }

  // Default to random category
  return categories[Math.floor(Math.random() * categories.length)];
}

// Generate a description
function generateDescription(title, author, category) {
  return `A captivating ${category.toLowerCase()} book by ${author}. "${title}" takes readers on an unforgettable journey through imagination and reality. This compelling narrative showcases the author's unique storytelling talent and has been widely acclaimed by critics and readers alike.`;
}

// Main function to process the images and insert books
async function insertBooks() {
  try {
    const imagesDir = path.join(__dirname, "contains image");
    const files = fs.readdirSync(imagesDir);

    console.log(`Found ${files.length} image files in the directory.`);

    for (const file of files) {
      // Skip non-image files
      if (!file.match(/\.(jpg|jpeg|png|webp)$/i)) {
        continue;
      }

      // Format the book details
      const title = formatBookTitle(file);
      const author = generateAuthor();
      const isbn = generateISBN();
      const publicationYear = generatePublicationYear();
      const pageCount = generatePageCount();
      const category = generateCategory(title);
      const publisher = "Library Publishing House";
      const language = "English";
      const description = generateDescription(title, author, category);
      const imageUrl = `/images/${file}`;

      // Check if book with this title already exists to avoid duplicates
      const [existingBooks] = await db.execute(
        "SELECT id FROM books WHERE title = ?",
        [title]
      );

      if (existingBooks.length > 0) {
        console.log(`Book "${title}" already exists, skipping...`);
        continue;
      }

      // Insert the book
      const [result] = await db.execute(
        `INSERT INTO books (
          title, author, isbn, publicationYear, publisher, description,
          category, imageUrl, pageCount, language, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          author,
          isbn,
          publicationYear,
          publisher,
          description,
          category,
          imageUrl,
          pageCount,
          language,
          "available",
        ]
      );

      console.log(`Inserted book: "${title}" with ID ${result.insertId}`);
    }

    console.log("Book insertion complete!");
    process.exit(0);
  } catch (error) {
    console.error("Error inserting books:", error);
    process.exit(1);
  }
}

// Run the script
insertBooks();
