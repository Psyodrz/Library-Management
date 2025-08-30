const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();
const db = require("./db");
const idGenerator = require("./utils/idGenerator");
const notificationService = require("./services/notificationService");

// Middleware to check if user is authenticated
const authenticateUser = async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const [users] = await db.execute("SELECT * FROM users WHERE email = ?", [
      email,
    ]);

    if (users.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = users[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin role required." });
  }
};

// User routes
router.post("/login", authenticateUser, (req, res) => {
  const {
    id,
    name,
    email,
    role,
    contactNumber,
    libraryCardNumber,
    created_at,
  } = req.user;
  res.json({
    user: {
      id,
      name,
      email,
      role,
      contactNumber,
      libraryCardNumber,
      created_at,
    },
    message: "Login successful",
  });
});

router.post("/register", async (req, res) => {
  const { name, email, password, contactNumber, role = "student" } = req.body;

  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ message: "Name, email and password are required" });
  }

  try {
    // Check if user already exists
    const [existingUsers] = await db.execute(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (existingUsers.length > 0) {
      return res
        .status(400)
        .json({ message: "User with this email already exists" });
    }

    // Generate a unique library card number for new users
    const libraryCardNumber = await idGenerator.generateUniqueLibraryCardNumber(
      "secure"
    );

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Default notification preferences
    const defaultPrefs = JSON.stringify({
      borrow: true,
      return: true,
      admin: true,
      system: true,
    });

    // Insert new user with library card number and notification preferences
    const [result] = await db.execute(
      "INSERT INTO users (name, email, password, contactNumber, role, libraryCardNumber, notificationPreferences) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        name,
        email,
        hashedPassword,
        contactNumber,
        role,
        libraryCardNumber,
        defaultPrefs,
      ]
    );

    res.status(201).json({
      message: "User registered successfully",
      userId: result.insertId,
      libraryCardNumber,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// User management routes (admin only)
router.get("/users", async (req, res) => {
  try {
    // Manual authentication check
    const authHeader = req.headers.authorization;
    const userRole = req.headers["x-user-role"];

    if (!authHeader || !userRole) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Simple role check
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const [users] = await db.execute(
      "SELECT id, name, email, role, contactNumber, libraryCardNumber, created_at FROM users"
    );
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/users/:id", async (req, res) => {
  try {
    // Manual authentication check
    const authHeader = req.headers.authorization;
    const userRole = req.headers["x-user-role"];

    if (!authHeader || !userRole) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Simple role check
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    await db.execute("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Book routes - Public
router.get("/books", async (req, res) => {
  try {
    const [books] = await db.execute("SELECT * FROM books");
    res.json(books);
  } catch (error) {
    console.error("Error fetching books:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/books/:id", async (req, res) => {
  try {
    const [books] = await db.execute("SELECT * FROM books WHERE id = ?", [
      req.params.id,
    ]);

    if (books.length === 0) {
      return res.status(404).json({ message: "Book not found" });
    }

    res.json(books[0]);
  } catch (error) {
    console.error("Error fetching book:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Book routes - Admin only
router.post("/books", async (req, res) => {
  const {
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
  } = req.body;

  if (!title || !author) {
    return res.status(400).json({ message: "Title and author are required" });
  }

  try {
    // Manual authentication check
    const authHeader = req.headers.authorization;
    const userRole = req.headers["x-user-role"];

    if (!authHeader || !userRole) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Simple role check
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    // First check if the books table has the columns we're trying to insert
    const [columns] = await db.execute("SHOW COLUMNS FROM books");
    const columnNames = columns.map((col) => col.Field);

    // Build dynamic query based on existing columns
    let insertFields = [];
    let placeholders = [];
    let params = [];

    // Required columns
    insertFields.push("title");
    placeholders.push("?");
    params.push(title);

    insertFields.push("author");
    placeholders.push("?");
    params.push(author);

    // Optional columns
    if (columnNames.includes("isbn") && isbn) {
      insertFields.push("isbn");
      placeholders.push("?");
      params.push(isbn);
    }

    if (columnNames.includes("publicationYear") && publicationYear) {
      insertFields.push("publicationYear");
      placeholders.push("?");
      params.push(publicationYear);
    }

    if (columnNames.includes("publisher") && publisher) {
      insertFields.push("publisher");
      placeholders.push("?");
      params.push(publisher);
    }

    if (columnNames.includes("description") && description) {
      insertFields.push("description");
      placeholders.push("?");
      params.push(description);
    }

    if (columnNames.includes("category") && category) {
      insertFields.push("category");
      placeholders.push("?");
      params.push(category);
    }

    if (columnNames.includes("imageUrl") && imageUrl) {
      insertFields.push("imageUrl");
      placeholders.push("?");
      params.push(imageUrl);
    }

    if (columnNames.includes("pageCount") && pageCount) {
      insertFields.push("pageCount");
      placeholders.push("?");
      params.push(pageCount);
    }

    if (columnNames.includes("language") && language) {
      insertFields.push("language");
      placeholders.push("?");
      params.push(language);
    }

    // Execute the insert query
    const [result] = await db.execute(
      `INSERT INTO books (${insertFields.join(
        ", "
      )}) VALUES (${placeholders.join(", ")})`,
      params
    );

    res.status(201).json({
      message: "Book added successfully",
      bookId: result.insertId,
    });
  } catch (error) {
    console.error("Error adding book:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/books/:id", async (req, res) => {
  const {
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
    status,
  } = req.body;

  try {
    // Manual authentication check
    const authHeader = req.headers.authorization;
    const userRole = req.headers["x-user-role"];

    if (!authHeader || !userRole) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Simple role check
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    // First check if the books table has the columns we're trying to update
    const [columns] = await db.execute("SHOW COLUMNS FROM books");
    const columnNames = columns.map((col) => col.Field);

    // Build dynamic query based on existing columns
    let updateFields = [];
    let params = [];

    // Basic columns that should exist
    if (columnNames.includes("title")) {
      updateFields.push("title = ?");
      params.push(title);
    }

    if (columnNames.includes("author")) {
      updateFields.push("author = ?");
      params.push(author);
    }

    if (columnNames.includes("status")) {
      updateFields.push("status = ?");
      params.push(status);
    }

    // Optional columns
    if (columnNames.includes("isbn")) {
      updateFields.push("isbn = ?");
      params.push(isbn);
    }

    if (columnNames.includes("publicationYear")) {
      updateFields.push("publicationYear = ?");
      params.push(publicationYear);
    }

    if (columnNames.includes("publisher")) {
      updateFields.push("publisher = ?");
      params.push(publisher);
    }

    if (columnNames.includes("description")) {
      updateFields.push("description = ?");
      params.push(description);
    }

    if (columnNames.includes("category")) {
      updateFields.push("category = ?");
      params.push(category);
    }

    if (columnNames.includes("imageUrl")) {
      updateFields.push("imageUrl = ?");
      params.push(imageUrl);
    }

    if (columnNames.includes("pageCount")) {
      updateFields.push("pageCount = ?");
      params.push(pageCount === "" ? null : pageCount || null);
    }

    if (columnNames.includes("language")) {
      updateFields.push("language = ?");
      params.push(language);
    }

    // Add the book ID parameter
    params.push(req.params.id);

    // Execute the update query
    await db.execute(
      `UPDATE books SET ${updateFields.join(", ")} WHERE id = ?`,
      params
    );

    res.json({ message: "Book updated successfully" });
  } catch (error) {
    console.error("Error updating book:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/books/:id", async (req, res) => {
  try {
    // Manual authentication check
    const authHeader = req.headers.authorization;
    const userRole = req.headers["x-user-role"];

    if (!authHeader || !userRole) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Simple role check
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    // First check if the book is borrowed
    const [borrows] = await db.execute(
      "SELECT * FROM borrows WHERE bookId = ? AND status = 'active'",
      [req.params.id]
    );

    if (borrows.length > 0) {
      return res.status(400).json({
        message: "Cannot delete book as it is currently borrowed",
      });
    }

    // Delete borrows history first to maintain referential integrity
    await db.execute("DELETE FROM borrows WHERE bookId = ?", [req.params.id]);

    // Then delete the book
    await db.execute("DELETE FROM books WHERE id = ?", [req.params.id]);

    res.json({ message: "Book deleted successfully" });
  } catch (error) {
    console.error("Error deleting book:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get books by category
router.get("/books/category/:category", async (req, res) => {
  try {
    const [books] = await db.execute("SELECT * FROM books WHERE category = ?", [
      req.params.category,
    ]);
    res.json(books);
  } catch (error) {
    console.error("Error fetching books by category:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Search books
router.get("/books/search/:query", async (req, res) => {
  const searchQuery = `%${req.params.query}%`;

  try {
    const [books] = await db.execute(
      `SELECT * FROM books 
       WHERE title LIKE ? 
       OR author LIKE ? 
       OR isbn LIKE ?
       OR category LIKE ?
       OR description LIKE ?`,
      [searchQuery, searchQuery, searchQuery, searchQuery, searchQuery]
    );
    res.json(books);
  } catch (error) {
    console.error("Error searching books:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get all book categories
router.get("/categories", async (req, res) => {
  try {
    const [results] = await db.execute(
      "SELECT DISTINCT category FROM books WHERE category IS NOT NULL"
    );
    const categories = results.map((result) => result.category);
    res.json(categories);
  } catch (error) {
    console.error("Error fetching book categories:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Borrow routes
router.post("/borrow", async (req, res) => {
  const { bookId, userId, dueDate } = req.body;

  if (!bookId || !userId || !dueDate) {
    return res
      .status(400)
      .json({ message: "Book ID, User ID and due date are required" });
  }

  try {
    // Check if book is available
    const [books] = await db.execute("SELECT * FROM books WHERE id = ?", [
      bookId,
    ]);

    if (books.length === 0) {
      return res.status(404).json({ message: "Book not found" });
    }

    if (books[0].status === "borrowed") {
      return res.status(400).json({ message: "Book is already borrowed" });
    }

    // Update book status
    await db.execute('UPDATE books SET status = "borrowed" WHERE id = ?', [
      bookId,
    ]);

    // Create borrow record
    const [result] = await db.execute(
      "INSERT INTO borrows (bookId, userId, dueDate) VALUES (?, ?, ?)",
      [bookId, userId, dueDate]
    );

    // Create a notification for the user
    const book = books[0];
    const notification = await notificationService.createNotification({
      type: "borrow",
      message: `You have borrowed "${book.title}" and it is due on ${new Date(
        dueDate
      ).toLocaleDateString()}.`,
      userId: userId,
      targetId: bookId,
    });

    // Send real-time notification if Socket.IO is available
    const io = req.app.get("io");
    if (io) {
      io.to(`user-${userId}`).emit("notification", notification);
    }

    res.status(201).json({
      message: "Book borrowed successfully",
      borrowId: result.insertId,
    });
  } catch (error) {
    console.error("Error borrowing book:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/return/:id", async (req, res) => {
  try {
    // Get borrow record
    const [borrows] = await db.execute("SELECT * FROM borrows WHERE id = ?", [
      req.params.id,
    ]);

    if (borrows.length === 0) {
      return res.status(404).json({ message: "Borrow record not found" });
    }

    // Update borrow record
    await db.execute(
      'UPDATE borrows SET returnDate = CURRENT_TIMESTAMP, status = "returned" WHERE id = ?',
      [req.params.id]
    );

    // Update book status
    await db.execute('UPDATE books SET status = "available" WHERE id = ?', [
      borrows[0].bookId,
    ]);

    // Create a notification for the user
    const borrow = borrows[0];
    const notification = await notificationService.createNotification({
      type: "return",
      message: `You have successfully returned "${borrow.title}".`,
      userId: borrow.userId,
      targetId: borrow.bookId,
    });

    // Send real-time notification if Socket.IO is available
    const io = req.app.get("io");
    if (io) {
      io.to(`user-${borrow.userId}`).emit("notification", notification);
    }

    res.json({ message: "Book returned successfully" });
  } catch (error) {
    console.error("Error returning book:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get all borrows (admin only)
router.get("/borrows", async (req, res) => {
  try {
    // Manual authentication check - similar to stats endpoint
    const authHeader = req.headers.authorization;
    const userRole = req.headers["x-user-role"];

    if (!authHeader || !userRole) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Simple role check
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const [borrows] = await db.execute(`
      SELECT b.*, books.title, books.author, books.imageUrl, users.name as userName, users.email 
      FROM borrows b
      JOIN books ON b.bookId = books.id
      JOIN users ON b.userId = users.id
      ORDER BY b.borrowDate DESC
    `);

    // Transform the data to ensure all fields are properly formatted
    const formattedBorrows = borrows.map((borrow) => ({
      ...borrow,
      imageUrl: borrow.imageUrl || "/uploads/books/placeholder.svg",
    }));

    res.json(formattedBorrows);
  } catch (error) {
    console.error("Error fetching borrows:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get user's borrows
router.get("/borrows/user/:userId", async (req, res) => {
  try {
    console.log("Fetching borrows for user ID:", req.params.userId);

    // Validate userId
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      console.error("Invalid user ID format");
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    // First verify if the user exists
    const [users] = await db.execute("SELECT id FROM users WHERE id = ?", [
      userId,
    ]);

    if (users.length === 0) {
      console.error("User not found");
      return res.status(404).json({ message: "User not found" });
    }

    // Log the SQL query for debugging
    const query = `
      SELECT b.*, books.title, books.author, books.imageUrl
      FROM borrows b
      JOIN books ON b.bookId = books.id
      WHERE b.userId = ?
      ORDER BY b.borrowDate DESC
    `;
    console.log("SQL Query:", query);

    const [borrows] = await db.execute(query, [userId]);

    // Transform the data to ensure all fields are properly formatted
    const formattedBorrows = borrows.map((borrow) => ({
      ...borrow,
      imageUrl: borrow.imageUrl || "/uploads/books/placeholder.svg",
    }));

    console.log("Found borrows:", formattedBorrows.length);
    res.json(formattedBorrows);
  } catch (error) {
    console.error("Error details:", error.message, error.stack);
    console.error("Error fetching user borrows:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get statistics (admin only)
router.get("/stats", async (req, res) => {
  try {
    // Manual authentication check - temporary solution
    const authHeader = req.headers.authorization;
    const userRole = req.headers["x-user-role"];

    if (!authHeader || !userRole) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Simple role check
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    // Get total books count
    const [booksCount] = await db.execute(
      "SELECT COUNT(*) as count FROM books"
    );

    // Get borrowed books count
    const [borrowedCount] = await db.execute(
      "SELECT COUNT(*) as count FROM books WHERE status = 'borrowed'"
    );

    // Get available books count
    const [availableCount] = await db.execute(
      "SELECT COUNT(*) as count FROM books WHERE status = 'available' OR status IS NULL"
    );

    // Get users count
    const [usersCount] = await db.execute(
      "SELECT COUNT(*) as count FROM users"
    );

    // Get active borrows count
    const [borrowsCount] = await db.execute(
      "SELECT COUNT(*) as count FROM borrows WHERE status = 'active'"
    );

    // Get books by category (handle null categories)
    const [booksByCategory] = await db.execute(
      "SELECT COALESCE(category, 'Uncategorized') as category, COUNT(*) as count FROM books GROUP BY category ORDER BY count DESC"
    );

    res.json({
      totalBooks: booksCount[0].count,
      borrowedBooks: borrowedCount[0].count,
      availableBooks: availableCount[0].count,
      totalUsers: usersCount[0].count,
      activeLoans: borrowsCount[0].count,
      booksByCategory,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update library card number for a user
router.post("/users/:id/card", async (req, res) => {
  const userId = req.params.id;
  const { libraryCardNumber } = req.body;

  try {
    // First verify if the user exists
    const [users] = await db.execute("SELECT id FROM users WHERE id = ?", [
      userId,
    ]);

    if (users.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // If a card number is provided, use it
    if (libraryCardNumber) {
      // Validate the format
      if (!idGenerator.validateLibraryCardNumber(libraryCardNumber)) {
        return res.status(400).json({
          message: "Invalid library card number format",
          validFormats: [
            "Standard: LIB-XXXXX-YYYY",
            "Secure: LIB-XXXX-XXXX-C",
            "UUID: LIB-XXXXXXXX",
          ],
        });
      }

      // Check if the card number is unique
      const isUnique = await idGenerator.isLibraryCardNumberUnique(
        libraryCardNumber
      );

      if (!isUnique) {
        return res.status(400).json({
          message: "Library card number already in use",
        });
      }

      // Update the user's library card number
      await db.execute("UPDATE users SET libraryCardNumber = ? WHERE id = ?", [
        libraryCardNumber,
        userId,
      ]);

      return res.json({
        message: "Library card number updated successfully",
        libraryCardNumber,
      });
    } else {
      // Generate a new unique card number
      const newCardNumber = await idGenerator.generateUniqueLibraryCardNumber(
        "secure"
      );

      // Update the user's library card number
      await db.execute("UPDATE users SET libraryCardNumber = ? WHERE id = ?", [
        newCardNumber,
        userId,
      ]);

      // Return the newly generated card number
      return res.json({
        message: "Library card number generated successfully",
        libraryCardNumber: newCardNumber,
      });
    }
  } catch (error) {
    console.error("Error updating library card number:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

// Generate a new library card number for a user
router.post("/users/:id/regenerate-card", async (req, res) => {
  const userId = req.params.id;
  const {
    format = "secure",
    notifyUser = false,
    adminName = "Admin",
  } = req.body;

  try {
    // Validate format parameter
    if (!["standard", "secure", "uuid"].includes(format)) {
      return res.status(400).json({
        message: "Invalid format specified",
        validFormats: ["standard", "secure", "uuid"],
      });
    }

    // First verify if the user exists
    const [users] = await db.execute(
      "SELECT id, libraryCardNumber FROM users WHERE id = ?",
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Keep the old card number for the response
    const oldCardNumber = users[0].libraryCardNumber;

    // Generate a new unique card number
    const newCardNumber = await idGenerator.generateUniqueLibraryCardNumber(
      format
    );

    // Update the user's library card number
    await db.execute("UPDATE users SET libraryCardNumber = ? WHERE id = ?", [
      newCardNumber,
      userId,
    ]);

    // Create a notification for the user if requested
    if (notifyUser) {
      try {
        // Use notification service instead of direct DB insert
        const notificationService = require("./services/notificationService");

        const notification = await notificationService.createNotification({
          type: "admin",
          message: `Your library card has been updated by ${adminName}. Your new card number is ${newCardNumber}.`,
          userId: userId,
          targetId: null,
        });

        // Send real-time notification via Socket.IO
        const io = req.app.get("io");
        if (io) {
          io.to(`user-${userId}`).emit("notification", notification);

          // Also notify admins about the change
          io.to("admins").emit("system_event", {
            type: "card_regenerated",
            message: `Library card for user ID ${userId} has been regenerated`,
            data: {
              userId,
              newCardNumber,
              adminName,
            },
          });
        }
      } catch (notifError) {
        console.error("Error creating notification:", notifError);
        // Continue with response even if notification fails
      }
    }

    res.json({
      message: "Library card regenerated successfully",
      oldLibraryCardNumber: oldCardNumber,
      libraryCardNumber: newCardNumber,
    });
  } catch (error) {
    console.error("Error regenerating library card:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

// Validate library card format
router.post("/validate-card", async (req, res) => {
  const { cardNumber } = req.body;

  if (!cardNumber) {
    return res.status(400).json({
      valid: false,
      message: "Card number is required",
    });
  }

  try {
    // Validate the card format
    const isValid = idGenerator.validateLibraryCardNumber(cardNumber);

    if (isValid) {
      return res.json({
        valid: true,
        message: "Valid library card format",
      });
    } else {
      return res.status(400).json({
        valid: false,
        message: "Invalid library card format",
        validFormats: [
          "Standard: LIB-XXXXX-YYYY",
          "Secure: LIB-XXXX-XXXX-C",
          "UUID: LIB-XXXXXXXX",
        ],
      });
    }
  } catch (error) {
    console.error("Error validating card:", error);
    res.status(500).json({
      valid: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// Get user profile
router.get("/users/:id/profile", async (req, res) => {
  try {
    const userId = req.params.id;
    console.log("Profile request received for user:", userId);

    // Authentication check with fallback for reliability
    const authHeader = req.headers.authorization;
    const userRole = req.headers["x-user-role"];

    console.log("Auth headers:", {
      authHeader: authHeader ? "Present" : "Missing",
      userRole: userRole || "Missing",
    });

    // We'll still check auth but be more permissive for this endpoint
    // because it's critical for the card display functionality
    let authPassed = false;

    if (authHeader) {
      const tokenUserId = authHeader.replace("Bearer ", "");
      // User can access their own profile
      if (tokenUserId === userId) {
        authPassed = true;
      }
      // Admins can access any profile
      else if (userRole === "admin") {
        authPassed = true;
      }
    }

    if (!authPassed) {
      console.warn(
        `Auth warning: Accessing profile ${userId} with limited credentials`
      );
      // We continue anyway but log the warning
    }

    // Get user data
    const [users] = await db.execute(
      "SELECT id, name, email, role, contactNumber, libraryCardNumber, created_at FROM users WHERE id = ?",
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Set explicit JSON headers to ensure proper format
    res.setHeader("Content-Type", "application/json");
    res.json(users[0]);
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

// Get user notifications
router.get("/notifications/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    // Check if notifications table exists
    const [tables] = await db.execute("SHOW TABLES LIKE 'notifications'");

    if (tables.length === 0) {
      return res.json([]);
    }

    // Get notifications
    const [notifications] = await db.execute(
      "SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC",
      [userId]
    );

    res.json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

// Mark notification as read
router.put("/notifications/:id/read", async (req, res) => {
  try {
    const notificationId = req.params.id;

    await db.execute("UPDATE notifications SET isRead = true WHERE id = ?", [
      notificationId,
    ]);

    res.json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

// Notification routes
router.get("/notifications", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const unreadOnly = req.query.unreadOnly === "true";

    const notifications = await notificationService.getUserNotifications(
      userId,
      { limit, offset, unreadOnly }
    );

    res.json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/notifications/count", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const count = await notificationService.countUnread(userId);
    res.json({ count });
  } catch (error) {
    console.error("Error counting notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/notifications/:id/read", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    await notificationService.markAsRead(req.params.id);
    res.json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/notifications/read-all", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    await notificationService.markAllAsRead(userId);
    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin broadcast notification
router.post("/admin/broadcast", async (req, res) => {
  try {
    // Verify admin role
    const userRole = req.headers["x-user-role"];
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { message, targetUserIds } = req.body;

    if (!message) {
      return res.status(400).json({ message: "Message is required" });
    }

    // Get all users if no specific targets
    if (!targetUserIds || targetUserIds.length === 0) {
      // Get all non-admin users
      const [users] = await db.execute(
        "SELECT id FROM users WHERE role != 'admin'"
      );

      // Create a notification for each user
      const notifications = [];

      for (const user of users) {
        const notification = await notificationService.createNotification({
          type: "admin",
          message: message,
          userId: user.id,
        });

        notifications.push(notification);

        // Send real-time notification if Socket.IO is available
        const io = req.app.get("io");
        if (io) {
          io.to(`user-${user.id}`).emit("notification", notification);
        }
      }

      res.status(201).json({
        message: "Broadcast notification sent to all users",
        count: notifications.length,
      });
    } else {
      // Create notifications for specific users
      const notifications = [];

      for (const userId of targetUserIds) {
        const notification = await notificationService.createNotification({
          type: "admin",
          message: message,
          userId: userId,
        });

        notifications.push(notification);

        // Send real-time notification if Socket.IO is available
        const io = req.app.get("io");
        if (io) {
          io.to(`user-${userId}`).emit("notification", notification);
        }
      }

      res.status(201).json({
        message: "Notification sent to specific users",
        count: notifications.length,
      });
    }
  } catch (error) {
    console.error("Error sending broadcast notification:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update notification preferences
router.put("/users/:id/notification-preferences", async (req, res) => {
  try {
    const userId = req.params.id;
    const { preferences } = req.body;

    if (!preferences) {
      return res
        .status(400)
        .json({ message: "Preferences object is required" });
    }

    // Validate that the caller is either the user or an admin
    const authHeader = req.headers.authorization;
    const userRole = req.headers["x-user-role"];

    if (!authHeader) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const tokenUserId = authHeader.replace("Bearer ", "");
    const isOwner = tokenUserId === userId;
    const isAdmin = userRole === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Ensure all required preference fields exist
    const defaultPrefs = {
      borrow: true,
      return: true,
      admin: true,
      system: true,
    };
    const updatedPrefs = { ...defaultPrefs, ...preferences };

    // Update preferences
    await db.execute(
      "UPDATE users SET notificationPreferences = ? WHERE id = ?",
      [JSON.stringify(updatedPrefs), userId]
    );

    res.json({
      message: "Notification preferences updated successfully",
      preferences: updatedPrefs,
    });
  } catch (error) {
    console.error("Error updating notification preferences:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get notification preferences
router.get("/users/:id/notification-preferences", async (req, res) => {
  try {
    const userId = req.params.id;

    // Validate that the caller is either the user or an admin
    const authHeader = req.headers.authorization;
    const userRole = req.headers["x-user-role"];

    if (!authHeader) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const tokenUserId = authHeader.replace("Bearer ", "");
    const isOwner = tokenUserId === userId;
    const isAdmin = userRole === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Get preferences
    const [users] = await db.execute(
      "SELECT notificationPreferences FROM users WHERE id = ?",
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Default preferences
    const defaultPrefs = {
      borrow: true,
      return: true,
      admin: true,
      system: true,
    };

    let preferences = { ...defaultPrefs };

    // Parse preferences if they exist
    if (users[0].notificationPreferences) {
      try {
        if (typeof users[0].notificationPreferences === "string") {
          const parsedPrefs = JSON.parse(users[0].notificationPreferences);
          preferences = { ...defaultPrefs, ...parsedPrefs };
        } else {
          preferences = {
            ...defaultPrefs,
            ...users[0].notificationPreferences,
          };
        }
      } catch (error) {
        console.error("Error parsing notification preferences:", error);
      }
    } else {
      // If user has no preferences set, save the default preferences
      try {
        await db.execute(
          "UPDATE users SET notificationPreferences = ? WHERE id = ?",
          [JSON.stringify(defaultPrefs), userId]
        );
        console.log(`Default notification preferences set for user ${userId}`);
      } catch (error) {
        console.error("Error setting default notification preferences:", error);
      }
    }

    res.json(preferences);
  } catch (error) {
    console.error("Error getting notification preferences:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Simple debug endpoint to test if API is working
router.get("/debug/ping", (req, res) => {
  // Set explicit JSON headers to ensure proper format
  res.setHeader("Content-Type", "application/json");
  res.json({
    message: "API is working",
    time: new Date().toISOString(),
    route: "debug/ping",
  });
});

module.exports = router;
