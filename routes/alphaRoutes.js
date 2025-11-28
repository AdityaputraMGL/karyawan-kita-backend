/**
 * ========================================
 * ALPHA ROUTES
 * ========================================
 * API endpoints untuk alpha checking system
 *
 * Endpoints:
 * - POST   /api/alpha/check          - Manual trigger alpha check
 * - GET    /api/alpha/stats          - Get alpha statistics
 * - GET    /api/alpha/status         - Get system status
 * - DELETE /api/alpha/remove/:id     - Delete alpha record (Admin)
 * - PUT    /api/alpha/convert/:id    - Convert alpha to other status
 *
 * @author HRIS Development Team
 * @version 2.0.0
 */

const express = require("express");
const authMiddleware = require("../middleware/auth");

module.exports = function (prisma, alphaCheckService) {
  const router = express.Router();

  /**
   * ========================================
   * POST /api/alpha/check
   * ========================================
   * Manual trigger alpha check
   * Role: Admin, HR
   *
   * Body (optional):
   * {
   *   "date": "2025-11-22",    // Check specific date
   *   "days_ago": 1             // Check N days ago
   * }
   */
  router.post(
    "/check",
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const { date, days_ago } = req.body;

        console.log("🔧 Manual alpha check triggered by:", req.user.username);

        let result;

        if (date) {
          // Check specific date
          const checkDate = new Date(date);
          checkDate.setHours(0, 0, 0, 0);

          console.log("   Checking specific date:", date);
          result = await alphaCheckService.checkAlphaForDate(checkDate);
        } else if (days_ago) {
          // Check N days ago
          console.log("   Checking", days_ago, "day(s) ago");
          result = await alphaCheckService.manualCheckAlpha(parseInt(days_ago));
        } else {
          // Default: check yesterday
          console.log("   Checking yesterday (default)");
          result = await alphaCheckService.checkYesterdayAlpha();
        }

        res.json({
          message: "Alpha check completed",
          triggered_by: req.user.username,
          ...result,
        });
      } catch (error) {
        console.error("❌ Error in manual alpha check:", error);
        res.status(500).json({
          error: "Gagal melakukan alpha check",
          details: error.message,
        });
      }
    }
  );

  /**
   * ========================================
   * GET /api/alpha/stats
   * ========================================
   * Get alpha statistics untuk periode tertentu
   * Role: Admin, HR
   *
   * Query params:
   * - start_date: Start date (YYYY-MM-DD)
   * - end_date: End date (YYYY-MM-DD)
   * - month: Month (1-12)
   * - year: Year (YYYY)
   */
  router.get(
    "/stats",
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const { start_date, end_date, month, year } = req.query;

        let startDate, endDate;

        if (month && year) {
          // Get stats for specific month
          const monthNum = parseInt(month);
          const yearNum = parseInt(year);

          startDate = new Date(yearNum, monthNum - 1, 1);
          endDate = new Date(yearNum, monthNum, 0, 23, 59, 59);

          console.log(`📊 Getting stats for: ${monthNum}/${yearNum}`);
        } else if (start_date && end_date) {
          // Custom date range
          startDate = new Date(start_date);
          endDate = new Date(end_date);

          console.log(`📊 Getting stats for: ${start_date} to ${end_date}`);
        } else {
          // Default: current month
          const now = new Date();
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            0,
            23,
            59,
            59
          );

          console.log("📊 Getting stats for: Current month (default)");
        }

        const stats = await alphaCheckService.getAlphaStats(startDate, endDate);

        res.json(stats);
      } catch (error) {
        console.error("❌ Error fetching alpha stats:", error);
        res.status(500).json({
          error: "Gagal mengambil statistik alpha",
          details: error.message,
        });
      }
    }
  );

  /**
   * ========================================
   * GET /api/alpha/status
   * ========================================
   * Get system status & cron info
   * Role: Admin, HR
   */
  router.get(
    "/status",
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const today = new Date().toISOString().split("T")[0];
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split("T")[0];

        console.log("📡 Fetching alpha system status...");

        // Check if alpha has been recorded today
        const alphaToday = await prisma.attendance.findMany({
          where: {
            status: "alpa",
            tanggal: {
              gte: new Date(today),
            },
            recorded_by_role: "System",
          },
        });

        // Check yesterday's alpha
        const alphaYesterday = await prisma.attendance.findMany({
          where: {
            status: "alpa",
            tanggal: {
              gte: new Date(yesterdayStr),
              lt: new Date(today),
            },
            recorded_by_role: "System",
          },
        });

        res.json({
          status: "Alpha check service is running",
          cron_schedule: "Every day at 18:00 WIB",
          timezone: "Asia/Jakarta",
          today: {
            date: today,
            alpha_records: alphaToday.length,
          },
          yesterday: {
            date: yesterdayStr,
            alpha_records: alphaYesterday.length,
          },
          deduction_rate: "Rp 100.000 per alpha",
          system_info: {
            version: "2.0.0",
            last_check: "Check server logs",
          },
        });
      } catch (error) {
        console.error("❌ Error checking alpha status:", error);
        res.status(500).json({
          error: "Gagal mengecek status alpha",
          details: error.message,
        });
      }
    }
  );

  /**
   * ========================================
   * DELETE /api/alpha/remove/:attendance_id
   * ========================================
   * Delete alpha record
   * Role: Admin only
   *
   * Body:
   * {
   *   "reason": "Alasan penghapusan"
   * }
   */
  router.delete(
    "/remove/:attendance_id",
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRole(["Admin"]),
    async (req, res) => {
      try {
        const { attendance_id } = req.params;
        const { reason } = req.body;

        console.log(`🗑️ Delete alpha request by ${req.user.username}`);
        console.log(`   Attendance ID: ${attendance_id}`);
        console.log(`   Reason: ${reason || "Not specified"}`);

        // Check if it's an alpha record
        const record = await prisma.attendance.findUnique({
          where: { attendance_id: parseInt(attendance_id) },
          include: {
            employee: {
              select: {
                nama_lengkap: true,
              },
            },
          },
        });

        if (!record) {
          return res.status(404).json({
            error: "Record tidak ditemukan",
          });
        }

        if (record.status !== "alpa") {
          return res.status(400).json({
            error: "Record ini bukan alpha record",
            current_status: record.status,
          });
        }

        // Delete the alpha record
        await prisma.attendance.delete({
          where: { attendance_id: parseInt(attendance_id) },
        });

        console.log(`✅ Alpha record deleted successfully`);

        res.json({
          message: "Alpha record berhasil dihapus",
          deleted_record: {
            attendance_id: record.attendance_id,
            employee_name: record.employee.nama_lengkap,
            tanggal: record.tanggal.toISOString().split("T")[0],
            deleted_by: req.user.username,
            reason: reason || "Not specified",
          },
        });
      } catch (error) {
        console.error("❌ Error deleting alpha record:", error);
        res.status(500).json({
          error: "Gagal menghapus alpha record",
          details: error.message,
        });
      }
    }
  );

  /**
   * ========================================
   * PUT /api/alpha/convert/:attendance_id
   * ========================================
   * Convert alpha to other status
   * Role: Admin, HR
   *
   * Body:
   * {
   *   "new_status": "hadir|izin|sakit",
   *   "keterangan": "Alasan konversi"
   * }
   */
  router.put(
    "/convert/:attendance_id",
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const { attendance_id } = req.params;
        const { new_status, keterangan } = req.body;

        console.log(`✏️ Convert alpha request by ${req.user.username}`);
        console.log(`   Attendance ID: ${attendance_id}`);
        console.log(`   New status: ${new_status}`);

        // Validate new status
        if (!["hadir", "izin", "sakit"].includes(new_status)) {
          return res.status(400).json({
            error: "Status harus: hadir, izin, atau sakit",
            provided: new_status,
          });
        }

        // Check if it's an alpha record
        const record = await prisma.attendance.findUnique({
          where: { attendance_id: parseInt(attendance_id) },
          include: {
            employee: {
              select: {
                nama_lengkap: true,
              },
            },
          },
        });

        if (!record) {
          return res.status(404).json({
            error: "Record tidak ditemukan",
          });
        }

        if (record.status !== "alpa") {
          return res.status(400).json({
            error: "Record ini bukan alpha record",
            current_status: record.status,
          });
        }

        // Update the record
        const updated = await prisma.attendance.update({
          where: { attendance_id: parseInt(attendance_id) },
          data: {
            status: new_status,
            keterangan:
              keterangan ||
              `Converted from alpha to ${new_status} by ${req.user.username}`,
          },
          include: {
            employee: {
              select: {
                employee_id: true,
                nama_lengkap: true,
              },
            },
          },
        });

        console.log(
          `✅ Alpha converted successfully: ${record.status} → ${new_status}`
        );

        res.json({
          message: `Alpha record berhasil diubah menjadi ${new_status}`,
          updated_record: {
            attendance_id: updated.attendance_id,
            employee_name: updated.employee.nama_lengkap,
            tanggal: updated.tanggal.toISOString().split("T")[0],
            old_status: "alpa",
            new_status: new_status,
            keterangan: updated.keterangan,
            converted_by: req.user.username,
          },
        });
      } catch (error) {
        console.error("❌ Error converting alpha record:", error);
        res.status(500).json({
          error: "Gagal mengubah alpha record",
          details: error.message,
        });
      }
    }
  );

  /**
   * ========================================
   * GET /api/alpha/employee/:employee_id
   * ========================================
   * Get alpha records untuk employee tertentu
   * Role: Admin, HR
   */
  router.get(
    "/employee/:employee_id",
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const { employee_id } = req.params;
        const { start_date, end_date, month, year } = req.query;

        console.log(`📊 Getting alpha records for employee: ${employee_id}`);

        let startDate, endDate;

        if (month && year) {
          const monthNum = parseInt(month);
          const yearNum = parseInt(year);
          startDate = new Date(yearNum, monthNum - 1, 1);
          endDate = new Date(yearNum, monthNum, 0, 23, 59, 59);
        } else if (start_date && end_date) {
          startDate = new Date(start_date);
          endDate = new Date(end_date);
        } else {
          // Default: current month
          const now = new Date();
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            0,
            23,
            59,
            59
          );
        }

        const alphaRecords = await prisma.attendance.findMany({
          where: {
            employee_id: parseInt(employee_id),
            status: "alpa",
            tanggal: {
              gte: startDate,
              lte: endDate,
            },
          },
          include: {
            employee: {
              select: {
                employee_id: true,
                nama_lengkap: true,
                jabatan: true,
              },
            },
          },
          orderBy: {
            tanggal: "desc",
          },
        });

        const alphaCount = alphaRecords.length;
        const totalDeduction = alphaCount * 100000;

        res.json({
          employee_id: parseInt(employee_id),
          employee_name: alphaRecords[0]?.employee.nama_lengkap || "Unknown",
          period: {
            start: startDate.toISOString().split("T")[0],
            end: endDate.toISOString().split("T")[0],
          },
          alpha_count: alphaCount,
          total_deduction: totalDeduction,
          records: alphaRecords,
        });
      } catch (error) {
        console.error("❌ Error fetching employee alpha:", error);
        res.status(500).json({
          error: "Gagal mengambil data alpha karyawan",
          details: error.message,
        });
      }
    }
  );

  /**
   * ========================================
   * GET /api/alpha/summary
   * ========================================
   * Get summary alpha untuk semua karyawan (current month)
   * Role: Admin, HR
   */
  router.get(
    "/summary",
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          0,
          23,
          59,
          59
        );

        console.log("📊 Getting alpha summary for current month...");

        const alphaRecords = await prisma.attendance.findMany({
          where: {
            status: "alpa",
            tanggal: {
              gte: startDate,
              lte: endDate,
            },
          },
          include: {
            employee: {
              select: {
                employee_id: true,
                nama_lengkap: true,
                jabatan: true,
              },
            },
          },
          orderBy: {
            tanggal: "desc",
          },
        });

        // Group by employee
        const employeeSummary = {};

        alphaRecords.forEach((record) => {
          const empId = record.employee_id;

          if (!employeeSummary[empId]) {
            employeeSummary[empId] = {
              employee_id: empId,
              nama_lengkap: record.employee.nama_lengkap,
              jabatan: record.employee.jabatan,
              alpha_count: 0,
              total_deduction: 0,
            };
          }

          employeeSummary[empId].alpha_count++;
          employeeSummary[empId].total_deduction += 100000;
        });

        const summary = Object.values(employeeSummary).sort(
          (a, b) => b.alpha_count - a.alpha_count
        );

        res.json({
          period: {
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            month_name: now.toLocaleString("id-ID", { month: "long" }),
          },
          total_alpha_records: alphaRecords.length,
          total_deduction: alphaRecords.length * 100000,
          employees_affected: summary.length,
          top_10: summary.slice(0, 10),
          all_employees: summary,
        });
      } catch (error) {
        console.error("❌ Error fetching alpha summary:", error);
        res.status(500).json({
          error: "Gagal mengambil summary alpha",
          details: error.message,
        });
      }
    }
  );

  return router;
};
