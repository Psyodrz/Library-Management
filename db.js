const mysql = require("mysql2/promise");

// Create a connection pool
const pool = mysql.createPool({
  host: "localhost",
  user: "admin", // Replace with your MySQL username
  password: "Santosh.12", // Replace with your MySQL password
  database: "library_management",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test the database connection
pool
  .getConnection()
  .then((connection) => {
    console.log("Database connection successful");
    connection.release();
  })
  .catch((err) => {
    console.error("Database connection error:", err);
    if (err.code === "ER_ACCESS_DENIED_ERROR") {
      console.error(
        "Invalid MySQL credentials. Please check username and password."
      );
    } else if (err.code === "ER_BAD_DB_ERROR") {
      console.error("Database does not exist. Creating the database...");
      createDatabase();
    } else {
      console.error("Unexpected database error:", err.message);
    }
  });

// Function to create the database if it doesn't exist
async function createDatabase() {
  try {
    // Create a connection without specifying the database
    const tempPool = mysql.createPool({
      host: "localhost",
      user: "admin",
      password: "Santosh.12",
      waitForConnections: true,
      connectionLimit: 2,
      queueLimit: 0,
    });

    const connection = await tempPool.getConnection();
    await connection.execute(
      "CREATE DATABASE IF NOT EXISTS library_management"
    );
    console.log("Database created successfully");
    connection.release();
    await tempPool.end();

    // Now initialize the database tables
    await initializeDB();
  } catch (error) {
    console.error("Failed to create database:", error);
  }
}

// Create database tables if they don't exist
async function initializeDB() {
  try {
    const connection = await pool.getConnection();

    // Create books table with additional fields
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS books (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        author VARCHAR(255) NOT NULL,
        isbn VARCHAR(20) UNIQUE,
        publicationYear INT,
        publisher VARCHAR(255),
        description TEXT,
        category VARCHAR(100),
        imageUrl VARCHAR(255),
        pageCount INT,
        language VARCHAR(50),
        status ENUM('available', 'borrowed') DEFAULT 'available',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_title (title),
        INDEX idx_author (author),
        INDEX idx_category (category),
        INDEX idx_status (status)
      )
    `);
    console.log("Books table initialized");

    // Create users table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('student', 'faculty', 'admin') DEFAULT 'student',
        contactNumber VARCHAR(15),
        libraryCardNumber VARCHAR(20) UNIQUE,
        notificationPreferences JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_role (role),
        INDEX idx_library_card (libraryCardNumber)
      )
    `);
    console.log("Users table initialized");

    // Check if borrows table exists
    const [borrows] = await connection.execute("SHOW TABLES LIKE 'borrows'");

    if (borrows.length === 0) {
      console.log("Creating borrows table");
      // Create borrows table
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS borrows (
          id INT AUTO_INCREMENT PRIMARY KEY,
          bookId INT NOT NULL,
          userId INT NOT NULL,
          borrowDate DATETIME DEFAULT CURRENT_TIMESTAMP,
          dueDate DATETIME NOT NULL,
          returnDate DATETIME,
          status ENUM('active', 'returned') DEFAULT 'active',
          FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE,
          FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_status (status),
          INDEX idx_borrow_date (borrowDate),
          INDEX idx_due_date (dueDate)
        )
      `);
      console.log("Borrows table created");
    } else {
      // Make sure the borrows table has all required columns and indexes
      try {
        // Verify status column
        await connection.execute(`
          ALTER TABLE borrows 
          MODIFY COLUMN status ENUM('active', 'returned') DEFAULT 'active'
        `);

        // First get existing foreign key constraints
        const [foreignKeys] = await connection.execute(`
          SELECT CONSTRAINT_NAME 
          FROM information_schema.TABLE_CONSTRAINTS 
          WHERE TABLE_NAME='borrows' 
          AND CONSTRAINT_TYPE='FOREIGN KEY' 
          AND TABLE_SCHEMA='library_management'
        `);

        // Drop existing foreign keys if they exist
        for (const fk of foreignKeys) {
          await connection.execute(`
            ALTER TABLE borrows
            DROP FOREIGN KEY ${fk.CONSTRAINT_NAME}
          `);
          console.log(`Dropped foreign key: ${fk.CONSTRAINT_NAME}`);
        }

        // Re-add foreign key constraints with CASCADE option
        await connection.execute(`
          ALTER TABLE borrows
          ADD CONSTRAINT borrows_bookid_fk FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
        `);

        await connection.execute(`
          ALTER TABLE borrows
          ADD CONSTRAINT borrows_userid_fk FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        `);

        // Handle indexes one by one with try-catch to ignore if they already exist
        try {
          await connection.execute(
            `CREATE INDEX idx_status ON borrows(status)`
          );
        } catch (err) {
          if (
            !err.message.includes("Duplicate key name") &&
            !err.message.includes("already exists")
          ) {
            throw err;
          }
        }

        try {
          await connection.execute(
            `CREATE INDEX idx_borrow_date ON borrows(borrowDate)`
          );
        } catch (err) {
          if (
            !err.message.includes("Duplicate key name") &&
            !err.message.includes("already exists")
          ) {
            throw err;
          }
        }

        try {
          await connection.execute(
            `CREATE INDEX idx_due_date ON borrows(dueDate)`
          );
        } catch (err) {
          if (
            !err.message.includes("Duplicate key name") &&
            !err.message.includes("already exists")
          ) {
            throw err;
          }
        }

        console.log("Borrows table structure verified and updated");
      } catch (error) {
        console.log("Error updating borrows table structure:", error.message);
      }
    }

    // Create an admin user if it doesn't exist
    const [users] = await connection.execute(
      'SELECT * FROM users WHERE role = "admin" LIMIT 1'
    );

    if (users.length === 0) {
      const bcrypt = require("bcryptjs");
      const hashedPassword = await bcrypt.hash("admin123", 10);

      // Default notification preferences
      const defaultPrefs = JSON.stringify({
        borrow: true,
        return: true,
        admin: true,
        system: true,
      });

      await connection.execute(
        `
        INSERT INTO users (name, email, password, role, notificationPreferences) 
        VALUES ('Admin', 'admin@library.com', ?, 'admin', ?)
      `,
        [hashedPassword, defaultPrefs]
      );

      console.log("Admin user created");
    }

    // Create image_metadata table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS image_metadata (
        id INT AUTO_INCREMENT PRIMARY KEY,
        book_id INT,
        image_type ENUM('cover', 'interior') NOT NULL DEFAULT 'cover',
        file_path VARCHAR(255) NOT NULL,
        thumbnail_path VARCHAR(255),
        medium_path VARCHAR(255),
        original_filename VARCHAR(255),
        alt_text VARCHAR(255),
        caption TEXT,
        copyright VARCHAR(255),
        width INT,
        height INT,
        is_primary BOOLEAN DEFAULT FALSE,
        display_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        INDEX idx_book_id (book_id),
        INDEX idx_image_type (image_type),
        INDEX idx_primary (is_primary)
      )
    `);
    console.log("Image metadata table initialized");

    // Create notifications table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        userId INT,
        targetId INT,
        isRead BOOLEAN DEFAULT FALSE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (userId),
        INDEX idx_type (type),
        INDEX idx_is_read (isRead)
      )
    `);
    console.log("Notifications table initialized");

    connection.release();
    console.log("Database initialization completed");
  } catch (error) {
    console.error("Error initializing database:", error);
  }
}

// Run the initialization
initializeDB();

module.exports = pool;
