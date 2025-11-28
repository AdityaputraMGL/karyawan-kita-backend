const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Create uploads directory if not exists
const uploadDir = path.join(__dirname, "../uploads/sick-letters");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log("📁 Created uploads directory:", uploadDir);
}

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Format: employeeId_timestamp_originalname
    const employeeId =
      req.user?.employeeId || req.user?.employee_id || "unknown";
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/\s+/g, "_"); // Replace spaces with underscores
    const filename = `${employeeId}_${timestamp}_${originalName}`;
    cb(null, filename);
  },
});

// File filter - only allow PDF
const fileFilter = (req, file, cb) => {
  if (file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error("Only PDF files are allowed!"), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
});

module.exports = upload;
