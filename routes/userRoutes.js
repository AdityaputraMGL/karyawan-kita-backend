const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authMiddleware = require("../middleware/auth");
const nodemailer = require("nodemailer");

const JWT_SECRET =
  process.env.JWT_SECRET || "ganti_dengan_secret_key_yang_kuat";

// Konfigurasi Email Transporter
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Verifikasi koneksi email
emailTransporter.verify(function (error, success) {
  if (error) {
    console.error("❌ Email configuration error:", error);
  } else {
    console.log("✅ Email server is ready to send messages");
  }
});

module.exports = function (prisma) {
  const router = express.Router();
  // FILE: routes/userRoutes.js
  // HANYA SECTION YANG PERLU DIUBAH - GANTI DARI LINE 30 SAMPAI LINE 123

  // ✅ POST: Register user - UPDATED DENGAN FIELD BARU (Alamat, No HP, Jabatan)
  router.post("/register", async (req, res) => {
    // ⭐ TAMBAH 3 FIELD BARU DARI FRONTEND
    const {
      username,
      password,
      email,
      role,
      status_karyawan,
      nama_lengkap,
      alamat, // ⭐ FIELD BARU
      no_hp, // ⭐ FIELD BARU
      jabatan, // ⭐ FIELD BARU
      confirmPassword,
    } = req.body;

    try {
      // Validasi input - UPDATED
      if (!username || !password || !email) {
        return res.status(400).json({
          error: "Username, password, dan email wajib diisi.",
        });
      }

      // ⭐ VALIDASI NAMA LENGKAP (wajib)
      if (!nama_lengkap || nama_lengkap.trim() === "") {
        return res.status(400).json({
          error: "Nama lengkap wajib diisi.",
        });
      }

      // ⭐ VALIDASI PASSWORD COCOK
      if (password !== confirmPassword) {
        return res.status(400).json({
          error: "Password dan konfirmasi password tidak cocok.",
        });
      }

      // ⭐ VALIDASI PASSWORD MINIMAL 6 KARAKTER
      if (password.length < 6) {
        return res.status(400).json({
          error: "Password minimal 6 karakter.",
        });
      }

      // ⭐ VALIDASI NO HP (optional tapi jika ada harus valid)
      if (no_hp && !/^[0-9+\-\s()]+$/.test(no_hp)) {
        return res.status(400).json({
          error: "Nomor HP tidak valid.",
        });
      }

      // Cek apakah username sudah ada
      const existingUser = await prisma.user.findUnique({
        where: { username },
      });

      if (existingUser) {
        return res.status(400).json({
          error: "Username sudah terdaftar.",
        });
      }

      // Cek apakah email sudah ada
      const existingEmail = await prisma.user.findUnique({
        where: { email },
      });

      if (existingEmail) {
        return res.status(400).json({
          error: "Email sudah terdaftar.",
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Tentukan status karyawan
      const finalStatusKaryawan = status_karyawan || "Magang";

      // Tentukan gaji pokok berdasarkan status
      const gajiPokok =
        finalStatusKaryawan === "Magang"
          ? 5000000.0
          : finalStatusKaryawan === "Kontrak"
          ? 5000000.0
          : 5000000.0;

      // Create user
      const newUser = await prisma.user.create({
        data: {
          username,
          password: hashedPassword,
          email,
          role: role || "Karyawan",
          status_karyawan: finalStatusKaryawan,
        },
      });

      console.log("✅ User created:", {
        user_id: newUser.user_id,
        username: newUser.username,
        role: newUser.role,
        status_karyawan: newUser.status_karyawan,
      });

      // ⭐ CREATE EMPLOYEE DENGAN DATA LENGKAP (UPDATED)
      const employee = await prisma.employee.create({
        data: {
          user_id: newUser.user_id,
          nama_lengkap: nama_lengkap.trim(), // ⭐ DARI FRONTEND, BUKAN USERNAME
          alamat: alamat?.trim() || null, // ⭐ FIELD BARU
          no_hp: no_hp?.trim() || null, // ⭐ FIELD BARU
          jabatan: jabatan?.trim() || null, // ⭐ FIELD BARU
          status_karyawan: finalStatusKaryawan,
          gaji_pokok: gajiPokok,
          tanggal_masuk: new Date(), // ⭐ TAMBAH TANGGAL MASUK
        },
      });

      console.log("✅ Employee created:", {
        employee_id: employee.employee_id,
        user_id: employee.user_id,
        nama_lengkap: employee.nama_lengkap,
        alamat: employee.alamat, // ⭐ LOG ALAMAT
        no_hp: employee.no_hp, // ⭐ LOG NO HP
        jabatan: employee.jabatan, // ⭐ LOG JABATAN
        status_karyawan: employee.status_karyawan,
        gaji_pokok: employee.gaji_pokok,
      });

      // Generate token
      const token = jwt.sign(
        {
          userId: newUser.user_id,
          username: newUser.username,
          role: newUser.role,
          employee_id: employee.employee_id,
        },
        JWT_SECRET,
        { expiresIn: "24h" }
      );

      console.log("✅ Registration successful for:", username);
      console.log("  - User ID:", newUser.user_id);
      console.log("  - Employee ID:", employee.employee_id);
      console.log("  - Nama Lengkap:", employee.nama_lengkap);
      console.log("  - Alamat:", employee.alamat);
      console.log("  - No HP:", employee.no_hp);
      console.log("  - Jabatan:", employee.jabatan);

      // ⭐ RESPONSE UPDATED - KIRIM EMPLOYEE DATA LENGKAP
      res.status(201).json({
        message: "✅ Registrasi berhasil! Data karyawan telah tersimpan.",
        token,
        user: {
          user_id: newUser.user_id,
          username: newUser.username,
          email: newUser.email,
          role: newUser.role,
          employee_id: employee.employee_id,
          nama_lengkap: employee.nama_lengkap,
          status_karyawan: employee.status_karyawan,
        },
        employee: {
          employee_id: employee.employee_id,
          nama_lengkap: employee.nama_lengkap,
          alamat: employee.alamat,
          no_hp: employee.no_hp,
          jabatan: employee.jabatan,
          status_karyawan: employee.status_karyawan,
          gaji_pokok: employee.gaji_pokok,
          tanggal_masuk: employee.tanggal_masuk,
        },
      });
    } catch (error) {
      console.error("❌ Registration error:", error);

      // Handle unique constraint error
      if (error.code === "P2002") {
        return res.status(400).json({
          error: "Username atau email sudah terdaftar.",
          details: error.message,
        });
      }

      res.status(500).json({
        error: "Registrasi gagal.",
        details: error.message,
      });
    }
  });

  // ✅ POST: Login user
  router.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
      console.log("🔐 Login attempt for:", username);

      // Validasi input
      if (!username || !password) {
        return res.status(400).json({
          error: "Username dan password wajib diisi.",
        });
      }

      // Cari user dengan include employee
      const user = await prisma.user.findUnique({
        where: { username },
        include: {
          employee: true, // ⭐ Include employee data
        },
      });

      if (!user) {
        console.log("❌ User not found:", username);
        return res.status(401).json({
          error: "Username atau password salah.",
        });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        console.log("❌ Invalid password for:", username);
        return res.status(401).json({
          error: "Username atau password salah.",
        });
      }

      // ⭐ PENTING: Jika user tidak punya employee record, buat sekarang
      let employeeId = user.employee?.employee_id || null;

      if (!employeeId) {
        console.log("⚠ User doesn't have employee record, creating one...");

        const newEmployee = await prisma.employee.create({
          data: {
            user_id: user.user_id,
            nama_lengkap: user.username,
            status_karyawan: user.status_karyawan || "Magang",
            gaji_pokok: 5000000.0,
          },
        });

        employeeId = newEmployee.employee_id;
        console.log("✅ Employee record created:", employeeId);
      }

      console.log("✅ Login successful");
      console.log("  - User ID:", user.user_id);
      console.log("  - Username:", user.username);
      console.log("  - Role:", user.role);
      console.log(
        "  - Employee ID:",
        employeeId,
        "(type:",
        typeof employeeId,
        ")"
      );

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: user.user_id,
          username: user.username,
          role: user.role,
          employee_id: employeeId, // ⭐ INTEGER or null
        },
        JWT_SECRET,
        { expiresIn: "24h" }
      );

      console.log("  - Token generated, length:", token.length);

      res.json({
        token,
        user: {
          user_id: user.user_id,
          username: user.username,
          email: user.email,
          role: user.role,
          employee_id: employeeId, // ⭐ INTEGER
          nama_lengkap: user.employee?.nama_lengkap || user.username,
        },
      });
    } catch (error) {
      console.error("❌ Login error:", error);
      res.status(500).json({
        error: "Login gagal.",
        details: error.message,
      });
    }
  });

  // ✅ GET: Get current user profile
  router.get("/profile", authMiddleware.authenticateToken, async (req, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: { user_id: req.user.userId },
        include: {
          employee: true,
        },
        select: {
          user_id: true,
          username: true,
          email: true,
          role: true,
          status_karyawan: true,
          created_at: true,
          employee: {
            select: {
              employee_id: true,
              nama_lengkap: true,
              jabatan: true,
              no_hp: true,
              tanggal_masuk: true,
              gaji_pokok: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({ error: "User tidak ditemukan." });
      }

      res.json(user);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ error: "Gagal mengambil profil user." });
    }
  });

  // ✅ PUT: Update user profile
  router.put("/profile", authMiddleware.authenticateToken, async (req, res) => {
    const { email, nama_lengkap, no_hp, alamat } = req.body;

    try {
      // Update user data
      const updatedUser = await prisma.user.update({
        where: { user_id: req.user.userId },
        data: {
          email: email || undefined,
        },
      });

      // Update employee data if exists
      if (req.user.employee_id) {
        await prisma.employee.update({
          where: { employee_id: req.user.employee_id },
          data: {
            nama_lengkap: nama_lengkap || undefined,
            no_hp: no_hp || undefined,
            alamat: alamat || undefined,
          },
        });
      }

      res.json({ message: "Profil berhasil diupdate." });
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ error: "Gagal mengupdate profil." });
    }
  });

  // ✅ POST: Change password
  router.post(
    "/change-password",
    authMiddleware.authenticateToken,
    async (req, res) => {
      const { oldPassword, newPassword } = req.body;

      try {
        if (!oldPassword || !newPassword) {
          return res.status(400).json({
            error: "Password lama dan baru wajib diisi.",
          });
        }

        // Get current user
        const user = await prisma.user.findUnique({
          where: { user_id: req.user.userId },
        });

        // Verify old password
        const isValidPassword = await bcrypt.compare(
          oldPassword,
          user.password
        );

        if (!isValidPassword) {
          return res.status(401).json({
            error: "Password lama tidak sesuai.",
          });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await prisma.user.update({
          where: { user_id: req.user.userId },
          data: { password: hashedPassword },
        });

        console.log("✅ Password changed for user:", user.username);
        res.json({ message: "Password berhasil diubah." });
      } catch (error) {
        console.error("Error changing password:", error);
        res.status(500).json({ error: "Gagal mengubah password." });
      }
    }
  );

  // ✅ POST: Forgot password (generate reset token)
  router.post("/forgot-password", async (req, res) => {
    const { email } = req.body;

    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        // Jangan beri tahu kalau email tidak ditemukan (security)
        return res.json({
          message: "Jika email terdaftar, link reset password telah dikirim.",
        });
      }

      // Generate reset token
      const resetToken = jwt.sign({ userId: user.user_id }, JWT_SECRET, {
        expiresIn: "1h",
      });

      // Save token to database
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour

      await prisma.password_reset_tokens.create({
        data: {
          user_id: user.user_id,
          token: resetToken,
          expires_at: expiresAt,
        },
      });

      console.log("✅ Reset token generated for:", email);

      // ✅ KIRIM EMAIL
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

      const mailOptions = {
        from: `"HRIS Management" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Instruksi Reset Password",
        html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 0;
          background-color: #f5f5f5;
        }
        .container {
          max-width: 600px;
          margin: 40px auto;
          background-color: #ffffff;
          padding: 40px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
          color: #333;
          font-size: 24px;
          margin-bottom: 20px;
          font-weight: 600;
        }
        p {
          color: #333;
          font-size: 15px;
          margin-bottom: 15px;
        }
        .button {
          display: inline-block;
          padding: 12px 30px;
          background-color: #7c3aed;
          color: white !important;
          text-decoration: none;
          border-radius: 6px;
          margin: 20px 0;
          font-weight: 500;
          font-size: 15px;
        }
        .token-box {
          background-color: #f5f5f5;
          padding: 15px;
          border-radius: 6px;
          word-break: break-all;
          font-family: 'Courier New', monospace;
          font-size: 13px;
          color: #666;
          margin: 20px 0;
        }
        .warning {
          color: #333;
          font-size: 15px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Instruksi Reset Password</h1>
        
        <p>Anda menerima email ini karena Anda (atau seseorang lainnya) telah meminta untuk mereset password pada akun Anda.</p>
        
        <p>Silakan klik link di bawah ini untuk melanjutkan:</p>
        
        <a href="${resetUrl}" class="button">Reset Password Saya</a>
        
        <p class="warning">Link ini akan kedaluwarsa dalam 1 jam.</p>
        
        <p>Atau, Anda bisa menyalin token berikut untuk dimasukkan secara manual:</p>
        
        <div class="token-box">${resetToken}</div>
        
        <p>Jika Anda tidak meminta reset password ini, abaikan saja email ini.</p>
      </div>
    </body>
    </html>
  `,
      };

      try {
        await emailTransporter.sendMail(mailOptions);
        console.log("✅ Email sent successfully to:", email);
      } catch (emailError) {
        console.error("❌ Error sending email:", emailError);
        // Tetap return success untuk security
      }

      res.json({
        message:
          "Link reset password telah dikirim ke email Anda. Silakan cek inbox/spam.",
      });
    } catch (error) {
      console.error("Error in forgot password:", error);
      res.status(500).json({ error: "Gagal memproses permintaan." });
    }
  });

  // ✅ POST: Reset password with token
  router.post("/reset-password", async (req, res) => {
    const { token, newPassword } = req.body;

    try {
      if (!token || !newPassword) {
        return res.status(400).json({
          error: "Token dan password baru wajib diisi.",
        });
      }

      // Verify token
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (err) {
        return res.status(401).json({
          error: "Token tidak valid atau sudah expired.",
        });
      }

      // Check if token exists in database and not expired
      const resetTokenRecord = await prisma.password_reset_tokens.findUnique({
        where: { token },
      });

      if (!resetTokenRecord) {
        return res.status(401).json({
          error: "Token tidak valid.",
        });
      }

      if (new Date() > resetTokenRecord.expires_at) {
        return res.status(401).json({
          error: "Token sudah expired.",
        });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      await prisma.user.update({
        where: { user_id: decoded.userId },
        data: { password: hashedPassword },
      });

      // Delete used token
      await prisma.password_reset_tokens.delete({
        where: { token },
      });

      console.log("✅ Password reset successful for user:", decoded.userId);
      res.json({ message: "Password berhasil direset." });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ error: "Gagal reset password." });
    }
  });

  return router;
};
