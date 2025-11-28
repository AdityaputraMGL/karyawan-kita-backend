const express = require("express");
const { authenticateToken, authorizeRole } = require("../middleware/auth");

module.exports = function (prisma) {
  const router = express.Router();

  // Endpoint untuk Dashboard Stats (Hanya Admin/HR)
  router.get(
    "/dashboard",
    authenticateToken,
    authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const currentPeriod = new Date().toISOString().slice(0, 7);

        const totalEmployees = await prisma.employee.count();

        const attendanceToday = await prisma.attendance.findMany({
          where: {
            tanggal: {
              gte: today,
              lt: tomorrow,
            },
          },
        });

        const hadir = attendanceToday.filter(
          (a) => a.status === "hadir"
        ).length;
        const izin = attendanceToday.filter((a) => a.status !== "hadir").length;

        const cutiPending = await prisma.leaveRequest.count({
          where: { status: "pending" },
        });

        const payrollThisMonth = await prisma.payroll.findMany({
          where: { periode: currentPeriod },
          select: { total_gaji: true },
        });

        const gajiBulanIni = payrollThisMonth.reduce(
          (sum, p) => sum + (parseFloat(p.total_gaji) || 0),
          0
        );

        res.json({
          emp: totalEmployees,
          hadir: hadir,
          izin: izin,
          cutiPending: cutiPending,
          gajiBulanIni: gajiBulanIni,
        });
      } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({
          error: "Gagal mengambil data statistik dashboard.",
          details: error.message,
        });
      }
    }
  );

  // ✅ ENDPOINT BARU: Performance/Talent Stats untuk Grafik
  router.get(
    "/performance",
    authenticateToken,
    authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        // 1. Ambil semua data performance dengan relasi employee dan user
        const allPerformance = await prisma.performance.findMany({
          include: {
            employee: {
              select: {
                nama_lengkap: true,
                jabatan: true,
                user: {
                  select: {
                    role: true,
                  },
                },
              },
            },
          },
          orderBy: {
            periode: "desc",
          },
        });

        // 2. Distribusi Nilai Kinerja (untuk Pie/Donut Chart)
        const distribution = {
          excellent: allPerformance.filter((p) => p.nilai_kinerja >= 90).length,
          good: allPerformance.filter(
            (p) => p.nilai_kinerja >= 75 && p.nilai_kinerja < 90
          ).length,
          average: allPerformance.filter(
            (p) => p.nilai_kinerja >= 60 && p.nilai_kinerja < 75
          ).length,
          poor: allPerformance.filter((p) => p.nilai_kinerja < 60).length,
        };

        // 3. Rata-rata Nilai per Role (untuk Bar Chart)
        const roleStats = {};
        allPerformance.forEach((p) => {
          const role = p.employee?.user?.role || "Unknown";
          if (!roleStats[role]) {
            roleStats[role] = { total: 0, count: 0, sum: 0 };
          }
          roleStats[role].sum += p.nilai_kinerja;
          roleStats[role].count += 1;
        });

        const byRole = Object.keys(roleStats).map((role) => ({
          role: role,
          average: Math.round(roleStats[role].sum / roleStats[role].count),
          count: roleStats[role].count,
        }));

        // 4. Trend Nilai Kinerja per Periode (untuk Line Chart)
        const periodStats = {};
        allPerformance.forEach((p) => {
          const periode = p.periode;
          if (!periodStats[periode]) {
            periodStats[periode] = { sum: 0, count: 0 };
          }
          periodStats[periode].sum += p.nilai_kinerja;
          periodStats[periode].count += 1;
        });

        const trend = Object.keys(periodStats)
          .sort()
          .slice(-6) // Ambil 6 periode terakhir
          .map((periode) => ({
            periode: periode,
            average: Math.round(
              periodStats[periode].sum / periodStats[periode].count
            ),
            count: periodStats[periode].count,
          }));

        // 5. Top Performers (5 karyawan dengan nilai tertinggi periode terakhir)
        const latestPeriod = allPerformance[0]?.periode;
        const topPerformers = allPerformance
          .filter((p) => p.periode === latestPeriod)
          .sort((a, b) => b.nilai_kinerja - a.nilai_kinerja)
          .slice(0, 5)
          .map((p) => ({
            name: p.employee?.nama_lengkap || "Unknown",
            role: p.employee?.user?.role || "Unknown",
            score: p.nilai_kinerja,
            periode: p.periode,
          }));

        // 6. Summary Stats
        const totalRecords = allPerformance.length;
        const avgScore =
          totalRecords > 0
            ? Math.round(
                allPerformance.reduce((sum, p) => sum + p.nilai_kinerja, 0) /
                  totalRecords
              )
            : 0;

        res.json({
          summary: {
            totalRecords: totalRecords,
            averageScore: avgScore,
            latestPeriod: latestPeriod || "N/A",
          },
          distribution: distribution,
          byRole: byRole,
          trend: trend,
          topPerformers: topPerformers,
        });
      } catch (error) {
        console.error("Error fetching performance stats:", error);
        res.status(500).json({
          error: "Gagal mengambil data statistik performa.",
          details: error.message,
        });
      }
    }
  );

  return router;
};
