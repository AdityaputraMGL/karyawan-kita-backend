const express = require("express");
const { authenticateToken, authorizeRole } = require("../middleware/auth");
const upload = require("../middleware/upload");
const path = require("path");
const fs = require("fs");
const {
  calculateLeaveDays,
  getCurrentMonth,
  checkAndResetMonthlyQuota,
  checkLeaveQuota,
  updateEmployeeLeaveQuota,
  restoreLeaveQuota,
} = require("../services/leaveService");

module.exports = function (prisma) {
  const router = express.Router();

  // Serve static files for uploads
  router.use("/uploads", express.static(path.join(__dirname, "../uploads")));

  // GET - All leave requests
  router.get("/", authenticateToken, async (req, res) => {
    try {
      const userRole = req.user.role;
      const employeeId = req.user.employeeId || req.user.employee_id;

      let whereClause = {};
      if (userRole === "Karyawan") {
        if (!employeeId) {
          return res
            .status(400)
            .json({ error: "Employee ID tidak ditemukan." });
        }
        whereClause = { employee_id: parseInt(employeeId) };
      }

      const leaveRequests = await prisma.leaveRequest.findMany({
        where: whereClause,
        orderBy: { tanggal_pengajuan: "desc" },
        include: {
          employee: {
            select: { nama_lengkap: true, jabatan: true },
          },
        },
      });

      res.json(leaveRequests);
    } catch (error) {
      console.error("❌ Error:", error);
      res.status(500).json({ error: "Gagal mengambil data." });
    }
  });

  // GET quota
  router.get("/quota", authenticateToken, async (req, res) => {
    try {
      const employeeId = req.user.employeeId || req.user.employee_id;
      if (!employeeId) {
        return res.status(400).json({ error: "Employee ID tidak ditemukan." });
      }

      await checkAndResetMonthlyQuota(prisma, employeeId);

      const employee = await prisma.employee.findUnique({
        where: { employee_id: parseInt(employeeId) },
        select: {
          nama_lengkap: true,
          monthly_leave_quota: true,
          used_leave_days_this_month: true,
        },
      });

      res.json({
        employee_name: employee.nama_lengkap,
        month: getCurrentMonth(),
        total_quota: employee.monthly_leave_quota,
        used_days: employee.used_leave_days_this_month,
        remaining_days:
          employee.monthly_leave_quota - employee.used_leave_days_this_month,
      });
    } catch (error) {
      console.error("❌ Error:", error);
      res.status(500).json({ error: "Gagal mengambil kuota." });
    }
  });

  // POST - Create leave (with file upload for "Sakit")
  router.post(
    "/",
    authenticateToken,
    upload.single("attachment"),
    async (req, res) => {
      try {
        const { tanggal_mulai, tanggal_selesai, jenis_pengajuan, alasan } =
          req.body;
        const employeeId = req.user.employeeId || req.user.employee_id;

        console.log("\n📝 Creating leave:", jenis_pengajuan);
        console.log("  - File:", req.file ? req.file.filename : "No file");

        // Validasi: Jika "Sakit", wajib upload
        if (jenis_pengajuan === "Sakit" && !req.file) {
          return res.status(400).json({
            error: "Surat keterangan sakit (PDF) wajib di-upload.",
          });
        }

        const startDate = new Date(tanggal_mulai);
        const endDate = new Date(tanggal_selesai);
        const totalDays = calculateLeaveDays(startDate, endDate);

        // Cek kuota untuk "Cuti"
        if (jenis_pengajuan === "Cuti") {
          const quotaCheck = await checkLeaveQuota(
            prisma,
            employeeId,
            totalDays
          );
          if (!quotaCheck.sufficient) {
            return res.status(400).json({
              error: `Kuota tidak mencukupi! Sisa: ${quotaCheck.remaining} hari.`,
            });
          }
        }

        const leaveData = {
          employee_id: parseInt(employeeId),
          tanggal_pengajuan: new Date(),
          tanggal_mulai: startDate,
          tanggal_selesai: endDate,
          jenis_pengajuan,
          alasan: alasan || "",
          status: "pending",
          total_days: totalDays,
        };

        if (req.file) {
          leaveData.attachment_path = `/uploads/sick-letters/${req.file.filename}`;
          leaveData.attachment_filename = req.file.filename;
        }

        const newLeave = await prisma.leaveRequest.create({
          data: leaveData,
          include: {
            employee: { select: { nama_lengkap: true, jabatan: true } },
          },
        });

        res.status(201).json({
          ...newLeave,
          message: "Pengajuan berhasil dikirim.",
        });
      } catch (error) {
        console.error("❌ Error:", error);

        if (req.file) {
          const filePath = path.join(
            __dirname,
            "../uploads/sick-letters",
            req.file.filename
          );
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        res
          .status(400)
          .json({ error: "Gagal mengajukan.", details: error.message });
      }
    }
  );

  // ⭐ GET - Download attachment (NO AUTH - untuk bisa dibuka di browser)
  router.get("/attachment/:filename", async (req, res) => {
    try {
      const { filename } = req.params;
      const filePath = path.join(
        __dirname,
        "../uploads/sick-letters",
        filename
      );

      console.log("📄 Serving PDF:", filename);

      if (!fs.existsSync(filePath)) {
        console.error("❌ File not found:", filePath);
        return res.status(404).json({ error: "File tidak ditemukan." });
      }

      // Set headers untuk tampilkan PDF di browser
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

      // Stream file
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      console.error("❌ Error serving file:", error);
      res.status(500).json({ error: "Gagal memuat file." });
    }
  });

  // PUT - Update status
  router.put(
    "/:id/status",
    authenticateToken,
    authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        const leaveRequest = await prisma.leaveRequest.findUnique({
          where: { leave_id: parseInt(id) },
          include: {
            employee: {
              select: {
                nama_lengkap: true,
                used_leave_days_this_month: true,
                monthly_leave_quota: true,
              },
            },
          },
        });

        if (!leaveRequest) {
          return res.status(404).json({ error: "Data tidak ditemukan." });
        }

        const previousStatus = leaveRequest.status;

        // Update kuota (hanya untuk "Cuti")
        if (
          status === "approved" &&
          previousStatus === "pending" &&
          leaveRequest.jenis_pengajuan === "Cuti"
        ) {
          const leaveMonth = new Date(leaveRequest.tanggal_mulai)
            .toISOString()
            .substring(0, 7);
          if (leaveMonth === getCurrentMonth()) {
            await updateEmployeeLeaveQuota(
              prisma,
              leaveRequest.employee_id,
              leaveRequest.total_days
            );
          }
        }

        const updated = await prisma.leaveRequest.update({
          where: { leave_id: parseInt(id) },
          data: { status },
          include: {
            employee: {
              select: {
                nama_lengkap: true,
                used_leave_days_this_month: true,
                monthly_leave_quota: true,
              },
            },
          },
        });

        res.json(updated);
      } catch (error) {
        console.error("❌ Error:", error);
        res.status(400).json({ error: "Gagal update status." });
      }
    }
  );

  // DELETE
  router.delete("/:id", authenticateToken, async (req, res) => {
    try {
      const leaveRequest = await prisma.leaveRequest.findUnique({
        where: { leave_id: parseInt(req.params.id) },
      });

      if (!leaveRequest) {
        return res.status(404).json({ error: "Data tidak ditemukan." });
      }

      // Hapus file jika ada
      if (leaveRequest.attachment_filename) {
        const filePath = path.join(
          __dirname,
          "../uploads/sick-letters",
          leaveRequest.attachment_filename
        );
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      await prisma.leaveRequest.delete({
        where: { leave_id: parseInt(req.params.id) },
      });

      res.json({ message: "Berhasil dihapus." });
    } catch (error) {
      console.error("❌ Error:", error);
      res.status(500).json({ error: "Gagal menghapus." });
    }
  });

  return router;
};
