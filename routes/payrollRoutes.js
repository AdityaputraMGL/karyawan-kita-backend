const express = require("express");
const { authenticateToken, authorizeRole } = require("../middleware/auth");

module.exports = function (prisma) {
  const router = express.Router();

  // ========================================
  // TARIF POTONGAN
  // ========================================
  const POTONGAN_ALPA = 100000; // Rp 100.000 per hari
  const POTONGAN_TERLAMBAT = 25000; // Rp 25.000 per kejadian
  const POTONGAN_IZIN = 50000; // Rp 50.000 per hari
  const POTONGAN_SAKIT = 0; // Rp 0 (tidak ada potongan)

  // ========================================
  // GET: Calculate payroll otomatis
  // ========================================
  router.get(
    "/calculate",
    authenticateToken,
    authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const { month, year } = req.query;

        console.log("\n🔍 === PAYROLL CALCULATION DEBUG ===");
        console.log("Query params:", { month, year });

        if (!month || !year) {
          return res.status(400).json({
            error: "Parameter month dan year wajib diisi",
          });
        }

        const periodMonth = parseInt(month);
        const periodYear = parseInt(year);
        const periode = `${periodYear}-${String(periodMonth).padStart(2, "0")}`;

        console.log("Periode:", periode);

        // Get all employees
        const employees = await prisma.employee.findMany({
          include: {
            user: {
              select: {
                username: true,
                email: true,
                role: true,
                status_karyawan: true,
              },
            },
          },
        });

        console.log(`Total employees: ${employees.length}`);

        // Define date range for the period
        const startDate = new Date(periodYear, periodMonth - 1, 1);
        const endDate = new Date(periodYear, periodMonth, 0, 23, 59, 59);

        console.log("Date range:", {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        });

        // Get attendance data
        const attendances = await prisma.attendance.findMany({
          where: {
            tanggal: {
              gte: startDate,
              lte: endDate,
            },
          },
        });

        console.log(`Total attendances in period: ${attendances.length}`);

        // Get approved leaves
        const leaves = await prisma.leaveRequest.findMany({
          where: {
            status: "approved",
            OR: [
              {
                tanggal_mulai: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                tanggal_selesai: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                AND: [
                  {
                    tanggal_mulai: {
                      lte: startDate,
                    },
                  },
                  {
                    tanggal_selesai: {
                      gte: endDate,
                    },
                  },
                ],
              },
            ],
          },
        });

        console.log(`Total approved leaves in period: ${leaves.length}`);

        // Calculate payroll for each employee
        const payrollData = [];

        for (const employee of employees) {
          console.log(
            `\n--- Processing Employee ID: ${employee.employee_id} (${employee.nama_lengkap}) ---`
          );

          // Filter attendance for this employee
          const empAttendances = attendances.filter(
            (a) => a.employee_id === employee.employee_id
          );

          console.log(`  Attendances: ${empAttendances.length}`);

          // ========================================
          // COUNT ALPA (ALPHA)
          // ========================================
          const alpaCount = empAttendances.filter(
            (a) => a.status?.toLowerCase() === "alpa"
          ).length;
          const potonganAlpa = alpaCount * POTONGAN_ALPA;
          console.log(
            `  ❌ Alpa: ${alpaCount} days = Rp ${potonganAlpa.toLocaleString()}`
          );

          // ========================================
          // COUNT TERLAMBAT (LATE)
          // ========================================
          const lateRecords = empAttendances.filter((a) => {
            // Check if status is explicitly "terlambat"
            if (a.status?.toLowerCase() === "terlambat") return true;

            // Or check if jam_masuk is after 08:00
            if (!a.jam_masuk) return false;
            const timeParts = a.jam_masuk.split(":");
            const hour = parseInt(timeParts[0]);
            const minute = parseInt(timeParts[1] || 0);
            return hour > 8 || (hour === 8 && minute > 0);
          });
          const lateCount = lateRecords.length;
          const potonganTerlambat = lateCount * POTONGAN_TERLAMBAT;
          console.log(
            `  ⏰ Terlambat: ${lateCount} times = Rp ${potonganTerlambat.toLocaleString()}`
          );

          // ========================================
          // COUNT IZIN & SAKIT from attendance
          // ========================================
          let izinCount = empAttendances.filter(
            (a) => a.status?.toLowerCase() === "izin"
          ).length;

          let sakitCount = empAttendances.filter(
            (a) => a.status?.toLowerCase() === "sakit"
          ).length;

          console.log(`  📝 Izin dari attendance: ${izinCount} days`);
          console.log(`  🏥 Sakit dari attendance: ${sakitCount} days`);

          // ========================================
          // ADD LEAVES (CUTI)
          // ========================================
          const empLeaves = leaves.filter(
            (l) => l.employee_id === employee.employee_id
          );

          console.log(`  📋 Leave requests: ${empLeaves.length}`);

          empLeaves.forEach((leave, idx) => {
            console.log(`  Leave ${idx + 1}:`, {
              jenis: leave.jenis_pengajuan,
              mulai: leave.tanggal_mulai.toISOString().split("T")[0],
              selesai: leave.tanggal_selesai.toISOString().split("T")[0],
            });

            const start = new Date(leave.tanggal_mulai);
            const end = new Date(leave.tanggal_selesai);

            // Calculate days
            const diffTime = Math.abs(end.getTime() - start.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

            console.log(`    Duration: ${diffDays} days`);

            const jenisLower = (leave.jenis_pengajuan || "").toLowerCase();

            if (jenisLower.includes("sakit")) {
              sakitCount += diffDays;
              console.log(`    → Added to sakit count`);
            } else {
              // Default: Izin/Cuti
              izinCount += diffDays;
              console.log(`    → Added to izin/cuti count`);
            }
          });

          console.log(`  TOTAL Izin/Cuti: ${izinCount} days`);
          console.log(`  TOTAL Sakit: ${sakitCount} days`);

          // ========================================
          // CALCULATE TOTAL DEDUCTIONS
          // ========================================
          const potonganIzin = izinCount * POTONGAN_IZIN;
          const potonganSakit = sakitCount * POTONGAN_SAKIT;

          const totalPotongan =
            potonganAlpa + potonganTerlambat + potonganIzin + potonganSakit;

          console.log(
            `  💰 TOTAL POTONGAN: Rp ${totalPotongan.toLocaleString()}`
          );

          // ========================================
          // BUILD BREAKDOWN
          // ========================================
          const breakdown = [];
          const reasons = [];

          if (alpaCount > 0) {
            breakdown.push({
              type: "Alpa",
              count: alpaCount,
              amount: potonganAlpa,
              icon: "❌",
            });
            reasons.push(
              `${alpaCount}x Alpa = Rp ${potonganAlpa.toLocaleString("id-ID")}`
            );
          }

          if (lateCount > 0) {
            breakdown.push({
              type: "Terlambat",
              count: lateCount,
              amount: potonganTerlambat,
              icon: "⏰",
            });
            reasons.push(
              `${lateCount}x Terlambat = Rp ${potonganTerlambat.toLocaleString(
                "id-ID"
              )}`
            );
          }

          if (izinCount > 0) {
            breakdown.push({
              type: "Izin/Cuti",
              count: izinCount,
              amount: potonganIzin,
              icon: "📝",
            });
            reasons.push(
              `${izinCount}x Izin/Cuti = Rp ${potonganIzin.toLocaleString(
                "id-ID"
              )}`
            );
          }

          if (sakitCount > 0) {
            breakdown.push({
              type: "Sakit",
              count: sakitCount,
              amount: potonganSakit,
              icon: "🏥",
            });
            reasons.push(`${sakitCount}x Sakit (Tidak ada potongan)`);
          }

          const alasanPotongan =
            reasons.length > 0 ? reasons.join(" | ") : "Tidak ada potongan";

          // ========================================
          // CALCULATE NET SALARY
          // ========================================
          const basicSalary = parseFloat(employee.gaji_pokok) || 5000000;
          const netSalary = basicSalary - totalPotongan;

          payrollData.push({
            employee_id: employee.employee_id,
            nama_lengkap: employee.nama_lengkap,
            username: employee.user?.username || "-",
            role: employee.user?.role || "-",
            jabatan: employee.jabatan || "-",
            status_karyawan: employee.status_karyawan,
            gaji_pokok: basicSalary,
            tunjangan: 0,
            potongan: totalPotongan,
            alasan_potongan: alasanPotongan,
            total_gaji: netSalary,
            employee_role: employee.jabatan || "Karyawan",
            breakdown: breakdown,
            details: {
              alpa: alpaCount,
              terlambat: lateCount,
              izin: izinCount,
              sakit: sakitCount,
            },
          });
        }

        console.log("\n✅ Calculation completed");
        console.log("=".repeat(50));

        res.json({
          period: {
            month: periodMonth,
            year: periodYear,
            periode: periode,
            monthName: new Date(periodYear, periodMonth - 1).toLocaleString(
              "id-ID",
              { month: "long" }
            ),
          },
          payroll: payrollData,
          summary: {
            total_employees: payrollData.length,
            total_basic_salary: payrollData.reduce(
              (sum, p) => sum + p.gaji_pokok,
              0
            ),
            total_deductions: payrollData.reduce(
              (sum, p) => sum + p.potongan,
              0
            ),
            total_net_salary: payrollData.reduce(
              (sum, p) => sum + p.total_gaji,
              0
            ),
          },
        });
      } catch (error) {
        console.error("❌ Error calculating payroll:", error);
        res.status(500).json({
          error: "Gagal menghitung payroll",
          details: error.message,
        });
      }
    }
  );

  // ========================================
  // GET: Slip gaji sendiri (Karyawan)
  // ========================================
  router.get("/my-slip", authenticateToken, async (req, res) => {
    try {
      const employeeId = req.user.employee_id;

      if (!employeeId) {
        return res.status(400).json({
          error: "Employee ID tidak ditemukan dalam token",
        });
      }

      const myPayrolls = await prisma.payroll.findMany({
        where: { employee_id: employeeId },
        orderBy: { periode: "desc" },
        include: {
          employee: {
            select: {
              nama_lengkap: true,
              jabatan: true,
              status_karyawan: true,
            },
          },
        },
      });

      res.json(myPayrolls);
    } catch (error) {
      console.error("Error fetching my payroll:", error);
      res.status(500).json({ error: "Gagal mengambil slip gaji Anda." });
    }
  });

  // ========================================
  // GET: All payroll (Admin & HR) ⭐ WITH ORPHAN FILTERING
  // ========================================
  router.get(
    "/",
    authenticateToken,
    authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const { periode, employee_id } = req.query;

        let whereClause = {};
        if (periode) whereClause.periode = periode;
        if (employee_id) whereClause.employee_id = parseInt(employee_id);

        const payrolls = await prisma.payroll.findMany({
          where: whereClause,
          orderBy: { periode: "desc" },
          include: {
            employee: {
              select: {
                nama_lengkap: true,
                jabatan: true,
                status_karyawan: true,
                user: {
                  select: {
                    username: true,
                    role: true,
                  },
                },
              },
            },
          },
        });

        // ⭐ Filter out payroll records with null employee
        const validPayrolls = payrolls.filter(
          (payroll) => payroll.employee !== null
        );

        if (validPayrolls.length < payrolls.length) {
          console.log(
            `⚠️ Filtered out ${
              payrolls.length - validPayrolls.length
            } payroll records with missing employee`
          );
        }

        res.json(validPayrolls);
      } catch (error) {
        console.error("Error fetching payroll:", error);
        res.status(500).json({ error: "Gagal mengambil data payroll." });
      }
    }
  );

  // ========================================
  // POST: Create payroll
  // ========================================
  router.post(
    "/",
    authenticateToken,
    authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      const {
        employee_id,
        periode,
        gaji_pokok,
        tunjangan,
        potongan,
        alasan_potongan,
        total_gaji,
        employee_role,
      } = req.body;

      try {
        // Check if already exists
        const existing = await prisma.payroll.findFirst({
          where: {
            employee_id: parseInt(employee_id),
            periode: periode,
          },
        });

        if (existing) {
          return res.status(400).json({
            error: `Payroll untuk periode ${periode} dan karyawan ini sudah ada`,
          });
        }

        // Create
        const newPayroll = await prisma.payroll.create({
          data: {
            employee_id: parseInt(employee_id),
            periode: periode,
            gaji_pokok: parseFloat(gaji_pokok),
            tunjangan: parseFloat(tunjangan || 0),
            potongan: parseFloat(potongan || 0),
            alasan_potongan: alasan_potongan || "Tidak ada potongan",
            total_gaji: parseFloat(total_gaji),
            employee_role: employee_role || "Karyawan",
          },
        });

        console.log("✅ Payroll created:", newPayroll.payroll_id);
        res.status(201).json(newPayroll);
      } catch (error) {
        console.error("Error creating payroll:", error);
        res.status(400).json({
          error: "Gagal membuat data payroll",
          details: error.message,
        });
      }
    }
  );

  // ========================================
  // PUT: Update payroll
  // ========================================
  router.put(
    "/:id",
    authenticateToken,
    authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      const { id } = req.params;
      const {
        gaji_pokok,
        tunjangan,
        potongan,
        alasan_potongan,
        total_gaji,
        employee_role,
      } = req.body;

      try {
        const updateData = {};
        if (gaji_pokok !== undefined)
          updateData.gaji_pokok = parseFloat(gaji_pokok);
        if (tunjangan !== undefined)
          updateData.tunjangan = parseFloat(tunjangan);
        if (potongan !== undefined) updateData.potongan = parseFloat(potongan);
        if (alasan_potongan !== undefined)
          updateData.alasan_potongan = alasan_potongan;
        if (total_gaji !== undefined)
          updateData.total_gaji = parseFloat(total_gaji);
        if (employee_role !== undefined)
          updateData.employee_role = employee_role;

        const updatedPayroll = await prisma.payroll.update({
          where: { payroll_id: parseInt(id) },
          data: updateData,
        });

        console.log("✅ Payroll updated:", id);
        res.json(updatedPayroll);
      } catch (error) {
        console.error("Error updating payroll:", error);
        res.status(400).json({
          error: "Gagal memperbarui data payroll",
          details: error.message,
        });
      }
    }
  );

  // ========================================
  // DELETE: Delete payroll
  // ========================================
  router.delete(
    "/:id",
    authenticateToken,
    authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      const { id } = req.params;

      try {
        await prisma.payroll.delete({
          where: { payroll_id: parseInt(id) },
        });

        console.log("✅ Payroll deleted:", id);
        res.json({ message: "Data payroll berhasil dihapus." });
      } catch (error) {
        console.error("Error deleting payroll:", error);
        res.status(500).json({
          error: "Gagal menghapus data payroll",
          details: error.message,
        });
      }
    }
  );

  // ========================================
  // GET: Statistics
  // ========================================
  router.get(
    "/stats",
    authenticateToken,
    authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const { year } = req.query;
        const targetYear = year ? parseInt(year) : new Date().getFullYear();

        const payrolls = await prisma.payroll.findMany({
          where: {
            periode: {
              startsWith: `${targetYear}-`,
            },
          },
        });

        // Group by month
        const monthlyStats = {};
        for (let month = 1; month <= 12; month++) {
          const periodeStr = `${targetYear}-${String(month).padStart(2, "0")}`;
          const monthPayrolls = payrolls.filter(
            (p) => p.periode === periodeStr
          );

          monthlyStats[month] = {
            month,
            monthName: new Date(targetYear, month - 1).toLocaleString("id-ID", {
              month: "long",
            }),
            total_employees: monthPayrolls.length,
            total_basic_salary: monthPayrolls.reduce(
              (sum, p) => sum + parseFloat(p.gaji_pokok || 0),
              0
            ),
            total_deductions: monthPayrolls.reduce(
              (sum, p) => sum + parseFloat(p.potongan || 0),
              0
            ),
            total_net_salary: monthPayrolls.reduce(
              (sum, p) => sum + parseFloat(p.total_gaji || 0),
              0
            ),
          };
        }

        res.json({
          year: targetYear,
          monthly_stats: Object.values(monthlyStats),
          yearly_total: {
            total_basic_salary: payrolls.reduce(
              (sum, p) => sum + parseFloat(p.gaji_pokok || 0),
              0
            ),
            total_deductions: payrolls.reduce(
              (sum, p) => sum + parseFloat(p.potongan || 0),
              0
            ),
            total_net_salary: payrolls.reduce(
              (sum, p) => sum + parseFloat(p.total_gaji || 0),
              0
            ),
          },
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({
          error: "Gagal mengambil statistik",
          details: error.message,
        });
      }
    }
  );

  return router;
};
