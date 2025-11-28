const express = require("express");
const authMiddleware = require("../middleware/auth");

module.exports = function (prisma) {
  const router = express.Router();

  // Constants
  const POTONGAN_TERLAMBAT = 25000; // Rp 25.000 per kejadian
  const POTONGAN_ALPHA = 100000; // Rp 100.000 per hari (for reference)

  // Helper function untuk normalize employee_id sesuai tipe di database
  function normalizeEmployeeId(employeeId) {
    if (!employeeId && employeeId !== 0) return null;

    // Convert ke integer karena schema expects Int
    const parsed = parseInt(employeeId);

    if (isNaN(parsed)) {
      console.error("⚠️ Invalid employee_id:", employeeId);
      return null;
    }

    return parsed;
  }

  // ⭐ Helper function untuk apply auto potongan terlambat
  async function applyLateDeduction(employeeId, tanggal, jamMasuk) {
    const targetDate = tanggal ? new Date(tanggal) : new Date();
    const currentMonth = targetDate.toISOString().slice(0, 7); // Format: YYYY-MM

    console.log(`⚠️ TERLAMBAT detected - Auto applying deduction...`);
    console.log(`   Employee ID: ${employeeId}`);
    console.log(`   Date: ${targetDate.toISOString().slice(0, 10)}`);
    console.log(`   Time: ${jamMasuk}`);

    try {
      // Find or create payroll for this month
      let payroll = await prisma.payroll.findFirst({
        where: {
          employee_id: employeeId,
          periode: currentMonth,
        },
      });

      if (!payroll) {
        // Create new payroll with late deduction
        payroll = await prisma.payroll.create({
          data: {
            employee_id: employeeId,
            periode: currentMonth,
            gaji_pokok: 0, // Will be set by admin later
            tunjangan: 0,
            potongan: POTONGAN_TERLAMBAT,
            gaji_bersih: -POTONGAN_TERLAMBAT,
            alasan_potongan: `Terlambat ${targetDate
              .toISOString()
              .slice(0, 10)} jam ${jamMasuk}`,
          },
        });

        console.log(
          `  💰 Created Payroll with late deduction: Rp ${POTONGAN_TERLAMBAT.toLocaleString()}`
        );
      } else {
        // Update existing payroll
        const newPotongan = (payroll.potongan || 0) + POTONGAN_TERLAMBAT;
        const newGajiBersih =
          (payroll.gaji_pokok || 0) + (payroll.tunjangan || 0) - newPotongan;

        const updatedAlasanPotongan = payroll.alasan_potongan
          ? `${payroll.alasan_potongan}; Terlambat ${targetDate
              .toISOString()
              .slice(0, 10)} jam ${jamMasuk}`
          : `Terlambat ${targetDate
              .toISOString()
              .slice(0, 10)} jam ${jamMasuk}`;

        await prisma.payroll.update({
          where: { payroll_id: payroll.payroll_id },
          data: {
            potongan: newPotongan,
            gaji_bersih: newGajiBersih,
            alasan_potongan: updatedAlasanPotongan,
          },
        });

        console.log(
          `  💰 Updated Payroll - Total Potongan: Rp ${newPotongan.toLocaleString()}`
        );
      }

      return true;
    } catch (payrollError) {
      console.error(
        "❌ Error updating payroll for late deduction:",
        payrollError
      );
      return false;
    }
  }

  // ✅ GET semua data absensi - ROLE-AWARE dengan ENHANCED DEBUGGING
  router.get("/", authMiddleware.authenticateToken, async (req, res) => {
    try {
      const { role, employee_id } = req.user;

      console.log("\n" + "=".repeat(60));
      console.log("📊 GET /api/attendance - Fetching attendance data");
      console.log("=".repeat(60));
      console.log("👤 User Info:");
      console.log("   - Username:", req.user.username);
      console.log("   - Role:", role);
      console.log("   - Employee ID (raw):", employee_id);
      console.log("   - Employee ID type:", typeof employee_id);

      let whereClause = {};

      // Jika role Karyawan, filter hanya data mereka sendiri
      if (role === "Karyawan") {
        if (!employee_id && employee_id !== 0) {
          console.error("❌ Employee ID tidak ditemukan untuk user ini");
          return res.status(400).json({
            error: "Employee ID tidak ditemukan untuk user ini.",
            debug: {
              username: req.user.username,
              role: role,
              employee_id: employee_id,
            },
          });
        }

        // Normalize employee_id
        const normalizedId = normalizeEmployeeId(employee_id);

        if (normalizedId === null) {
          console.error("❌ Employee ID tidak dapat dinormalisasi");
          return res.status(400).json({
            error: "Employee ID tidak valid.",
            debug: {
              raw_employee_id: employee_id,
              normalized: normalizedId,
            },
          });
        }

        whereClause.employee_id = normalizedId;

        console.log("🔍 Filter Applied:");
        console.log("   - Filtering for employee_id:", normalizedId);
        console.log("   - Type:", typeof normalizedId);
        console.log("   - Where clause:", JSON.stringify(whereClause));
      } else if (role === "Admin" || role === "HR") {
        console.log("👑 Admin/HR access: showing all data");
      } else {
        console.error("❌ Role tidak dikenali:", role);
        return res.status(403).json({
          error: "Role tidak dikenali.",
        });
      }

      console.log("\n🔎 Executing Prisma query...");
      console.log(
        "   Query:",
        JSON.stringify(
          {
            where: whereClause,
            orderBy: { tanggal: "desc" },
            include: { employee: true },
          },
          null,
          2
        )
      );

      const attendanceList = await prisma.attendance.findMany({
        where: whereClause,
        orderBy: { tanggal: "desc" },
        include: {
          employee: true,
        },
      });

      // ⭐ Filter out attendance records with null employee
      const validAttendanceList = attendanceList.filter(
        (attendance) => attendance.employee !== null
      );

      if (validAttendanceList.length < attendanceList.length) {
        console.log(
          `⚠️ Filtered out ${
            attendanceList.length - validAttendanceList.length
          } attendance records with missing employee`
        );
      }

      console.log("\n✅ Query executed successfully");
      console.log("📦 Results:");
      console.log("   - Total records found:", validAttendanceList.length);

      if (validAttendanceList.length > 0) {
        console.log("   - Sample record:");
        const sample = validAttendanceList[0];
        console.log("     * attendance_id:", sample.attendance_id);
        console.log(
          "     * employee_id:",
          sample.employee_id,
          "(type:",
          typeof sample.employee_id,
          ")"
        );
        console.log("     * tanggal:", sample.tanggal);
        console.log("     * status:", sample.status);
        console.log(
          "     * employee.nama_lengkap:",
          sample.employee?.nama_lengkap || "N/A"
        );
      } else {
        console.log("   ⚠️ No records found!");

        // Additional debugging - check if ANY attendance exists for this employee
        if (whereClause.employee_id) {
          console.log(
            "\n🔍 Additional Debug - Checking all attendance records..."
          );
          const allAttendance = await prisma.attendance.findMany({
            select: { attendance_id: true, employee_id: true },
          });
          console.log("   - Total attendance in DB:", allAttendance.length);

          const uniqueEmployeeIds = [
            ...new Set(allAttendance.map((a) => a.employee_id)),
          ];
          console.log("   - Unique employee_ids in DB:", uniqueEmployeeIds);
          console.log("   - Looking for:", whereClause.employee_id);
          console.log(
            "   - Match found:",
            uniqueEmployeeIds.includes(whereClause.employee_id) ? "YES" : "NO"
          );
        }
      }

      console.log("=".repeat(60) + "\n");

      res.json(validAttendanceList);
    } catch (error) {
      console.error("\n" + "❌".repeat(30));
      console.error("❌ Error fetching attendance:");
      console.error("   Message:", error.message);
      console.error("   Stack:", error.stack);
      console.error("❌".repeat(30) + "\n");

      res.status(500).json({
        error: "Gagal mengambil data absensi.",
        details: error.message,
      });
    }
  });

  // ⭐ NEW: GET Pending approval requests (Admin/HR only)
  router.get(
    "/pending-approvals",
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        console.log("📡 Fetching pending approval requests...");

        const pendingRequests = await prisma.attendance.findMany({
          where: {
            approval_status: "pending",
          },
          orderBy: [{ tanggal: "desc" }, { created_at: "desc" }],
          include: {
            employee: {
              select: {
                employee_id: true,
                nama_lengkap: true,
                jabatan: true,
              },
            },
          },
        });

        console.log(
          `✅ Found ${pendingRequests.length} pending approval requests`
        );
        res.json(pendingRequests);
      } catch (error) {
        console.error("❌ Error fetching pending approvals:", error);
        res.status(500).json({
          error: "Gagal mengambil data pending approvals",
          details: error.message,
        });
      }
    }
  );

  // ⭐ NEW: POST Approve/Reject attendance
  router.post(
    "/approve/:attendance_id",
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      try {
        const { attendance_id } = req.params;
        const { action, notes } = req.body;
        const adminId = req.user.user_id;

        console.log(
          `📤 Processing ${action} for attendance ID: ${attendance_id}`
        );

        if (!["approve", "reject"].includes(action)) {
          return res.status(400).json({
            error: "Action harus 'approve' atau 'reject'",
          });
        }

        const attendance = await prisma.attendance.findUnique({
          where: { attendance_id: parseInt(attendance_id) },
          include: {
            employee: {
              select: {
                nama_lengkap: true,
              },
            },
          },
        });

        if (!attendance) {
          return res.status(404).json({
            error: "Attendance tidak ditemukan",
          });
        }

        if (attendance.approval_status !== "pending") {
          return res.status(400).json({
            error: `Request ini sudah ${attendance.approval_status}`,
          });
        }

        const updated = await prisma.attendance.update({
          where: { attendance_id: parseInt(attendance_id) },
          data: {
            approval_status: action === "approve" ? "approved" : "rejected",
            approved_by: adminId,
            approval_notes: notes || null,
            approval_date: new Date(),
            status: action === "approve" ? "approved" : "rejected",
          },
        });

        const message =
          action === "approve"
            ? `✅ Request ${attendance.tipe_kerja} dari ${attendance.employee.nama_lengkap} telah disetujui`
            : `❌ Request ${attendance.tipe_kerja} dari ${attendance.employee.nama_lengkap} ditolak`;

        console.log(message);
        res.json({
          message: message,
          data: updated,
        });
      } catch (error) {
        console.error("❌ Error approving attendance:", error);
        res.status(500).json({
          error: "Gagal memproses approval",
          details: error.message,
        });
      }
    }
  );

  // ⭐ NEW: POST Request WFH/Hybrid (need approval)
  router.post(
    "/request-wfh",
    authMiddleware.authenticateToken,
    async (req, res) => {
      try {
        const employeeId = req.user.employee_id;
        const { tanggal, tipe_kerja } = req.body;

        console.log("📤 WFH request from employee:", employeeId);

        if (!employeeId) {
          return res.status(400).json({
            error: "Employee ID tidak ditemukan dalam token",
          });
        }

        const normalizedId = normalizeEmployeeId(employeeId);

        if (!["WFH (Work From Home)", "Hybrid"].includes(tipe_kerja)) {
          return res.status(400).json({
            error: "Tipe kerja harus WFH atau Hybrid",
          });
        }

        const existing = await prisma.attendance.findFirst({
          where: {
            employee_id: normalizedId,
            tanggal: new Date(tanggal),
          },
        });

        if (existing) {
          return res.status(400).json({
            error: "Anda sudah memiliki absensi untuk tanggal ini",
          });
        }

        const newRequest = await prisma.attendance.create({
          data: {
            employee_id: normalizedId,
            tanggal: new Date(tanggal),
            tipe_kerja: tipe_kerja,
            status: "pending_approval",
            approval_status: "pending",
            jam_masuk: null,
            jam_pulang: null,
            lokasi_masuk: null,
            lokasi_pulang: null,
            recorded_by_role: "Karyawan",
          },
        });

        console.log(
          `✅ WFH/Hybrid request created for employee ${normalizedId}`
        );
        res.status(201).json({
          message: `✅ Request ${tipe_kerja} berhasil dikirim. Menunggu approval dari admin.`,
          data: newRequest,
        });
      } catch (error) {
        console.error("❌ Error creating WFH request:", error);
        res.status(500).json({
          error: "Gagal membuat request",
          details: error.message,
        });
      }
    }
  );

  // ✅ GET absensi by ID - ROLE-AWARE
  router.get("/:id", authMiddleware.authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { role, employee_id } = req.user;

    try {
      const attendance = await prisma.attendance.findUnique({
        where: { attendance_id: parseInt(id) },
        include: {
          employee: true,
        },
      });

      if (!attendance) {
        return res.status(404).json({ error: "Data absensi tidak ditemukan." });
      }

      // Karyawan hanya bisa lihat data mereka sendiri
      const normalizedId = normalizeEmployeeId(employee_id);
      if (role === "Karyawan" && attendance.employee_id !== normalizedId) {
        return res.status(403).json({
          error: "Anda tidak memiliki akses ke data absensi ini.",
        });
      }

      res.json(attendance);
    } catch (error) {
      console.error("Error fetching attendance:", error);
      res.status(500).json({ error: "Gagal mengambil data absensi." });
    }
  });

  // ✅ POST: Mencatat absensi - ROLE-AWARE ⭐ WITH AUTO POTONGAN FOR MANUAL ENTRY
  router.post("/", authMiddleware.authenticateToken, async (req, res) => {
    const { role, employee_id: userEmployeeId } = req.user;
    const {
      employee_id,
      tanggal,
      jam_masuk,
      jam_pulang,
      status,
      tipe_kerja,
      lokasi_masuk,
      lokasi_pulang,
      akurasi_masuk,
      akurasi_pulang,
      recorded_by_role,
    } = req.body;

    try {
      // Validasi employee_id
      if (!employee_id) {
        return res.status(400).json({ error: "employee_id wajib diisi." });
      }

      const normalizedUserId = normalizeEmployeeId(userEmployeeId);
      const normalizedTargetId = normalizeEmployeeId(employee_id);

      // Karyawan hanya bisa mencatat absensi mereka sendiri
      if (role === "Karyawan" && normalizedTargetId !== normalizedUserId) {
        return res.status(403).json({
          error: "Anda hanya dapat mencatat absensi untuk diri sendiri.",
        });
      }

      // Cek apakah employee exists
      const employeeExists = await prisma.employee.findUnique({
        where: { employee_id: normalizedTargetId },
      });

      if (!employeeExists) {
        return res.status(400).json({ error: "Employee tidak ditemukan." });
      }

      console.log("📥 Creating attendance with data:");
      console.log("   - employee_id:", normalizedTargetId);
      console.log("   - status:", status);
      console.log("   - jam_masuk:", jam_masuk);
      console.log("   - lokasi_masuk:", lokasi_masuk);
      console.log("   - akurasi_masuk:", akurasi_masuk);

      const newAttendance = await prisma.attendance.create({
        data: {
          employee_id: normalizedTargetId,
          tanggal: tanggal ? new Date(tanggal) : new Date(),
          jam_masuk: jam_masuk || null,
          jam_pulang: jam_pulang || null,
          status: status || "hadir",
          tipe_kerja: tipe_kerja || "WFO",
          lokasi_masuk: lokasi_masuk || null,
          lokasi_pulang: lokasi_pulang || null,
          akurasi_masuk: akurasi_masuk ? parseInt(akurasi_masuk) : null,
          akurasi_pulang: akurasi_pulang ? parseInt(akurasi_pulang) : null,
          recorded_by_role: recorded_by_role || role,
        },
        include: {
          employee: true,
        },
      });

      console.log("✅ Attendance saved to DB:", newAttendance.attendance_id);
      console.log("   - lokasi_masuk saved:", newAttendance.lokasi_masuk);
      console.log("   - akurasi_masuk saved:", newAttendance.akurasi_masuk);
      console.log("   - status saved:", newAttendance.status);

      // ⭐⭐⭐ AUTO POTONGAN FOR MANUAL ENTRY IF TERLAMBAT ⭐⭐⭐
      if (status === "terlambat" && jam_masuk) {
        console.log("⚠️ Manual entry with TERLAMBAT status detected!");
        await applyLateDeduction(normalizedTargetId, tanggal, jam_masuk);
      }

      res.status(201).json(newAttendance);
    } catch (error) {
      console.error("❌ Error creating attendance:", error);
      res.status(400).json({
        error: "Gagal mencatat absensi.",
        details: error.message,
      });
    }
  });

  // ✅ PUT: Update absensi - ROLE-AWARE
  router.put("/:id", authMiddleware.authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { role, employee_id: userEmployeeId } = req.user;
    const {
      jam_masuk,
      jam_pulang,
      status,
      tipe_kerja,
      lokasi_masuk,
      lokasi_pulang,
      akurasi_masuk,
      akurasi_pulang,
    } = req.body;

    try {
      const existingAttendance = await prisma.attendance.findUnique({
        where: { attendance_id: parseInt(id) },
      });

      if (!existingAttendance) {
        return res.status(404).json({ error: "Data absensi tidak ditemukan." });
      }

      const normalizedUserId = normalizeEmployeeId(userEmployeeId);

      // Karyawan hanya bisa update absensi mereka sendiri
      if (
        role === "Karyawan" &&
        existingAttendance.employee_id !== normalizedUserId
      ) {
        return res.status(403).json({
          error: "Anda hanya dapat mengupdate absensi diri sendiri.",
        });
      }

      // Build update data object
      const updateData = {};
      if (jam_masuk !== undefined) updateData.jam_masuk = jam_masuk;
      if (jam_pulang !== undefined) updateData.jam_pulang = jam_pulang;
      if (status !== undefined) updateData.status = status;
      if (tipe_kerja !== undefined) updateData.tipe_kerja = tipe_kerja;
      if (lokasi_masuk !== undefined) updateData.lokasi_masuk = lokasi_masuk;
      if (lokasi_pulang !== undefined) updateData.lokasi_pulang = lokasi_pulang;
      if (akurasi_masuk !== undefined)
        updateData.akurasi_masuk = parseInt(akurasi_masuk);
      if (akurasi_pulang !== undefined)
        updateData.akurasi_pulang = parseInt(akurasi_pulang);

      const updatedAttendance = await prisma.attendance.update({
        where: { attendance_id: parseInt(id) },
        data: updateData,
        include: {
          employee: true,
        },
      });

      console.log(`✅ Attendance updated by ${role} for ID ${id}`);
      res.json(updatedAttendance);
    } catch (error) {
      console.error("Error updating attendance:", error);
      res.status(400).json({
        error: "Gagal mengupdate absensi.",
        details: error.message,
      });
    }
  });

  // ✅ POST: Check-in dengan Logic Terlambat + AUTO POTONGAN ⭐ UPDATED
  router.post(
    "/checkin",
    authMiddleware.authenticateToken,
    async (req, res) => {
      const { role, employee_id: userEmployeeId } = req.user;
      const {
        employee_id,
        jam_masuk,
        tipe_kerja,
        lokasi_masuk,
        akurasi_masuk,
      } = req.body;

      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const currentTime = `${String(currentHour).padStart(2, "0")}:${String(
        currentMinute
      ).padStart(2, "0")}`;
      const today = now.toISOString().slice(0, 10);

      try {
        let targetEmployeeId;

        if (role === "Karyawan") {
          targetEmployeeId = normalizeEmployeeId(userEmployeeId);
        } else if (role === "Admin" || role === "HR") {
          if (!employee_id) {
            return res.status(400).json({ error: "employee_id wajib diisi." });
          }
          targetEmployeeId = normalizeEmployeeId(employee_id);
        } else {
          return res.status(403).json({ error: "Role tidak dikenali." });
        }

        if (!targetEmployeeId) {
          return res
            .status(400)
            .json({ error: "employee_id tidak dapat ditentukan." });
        }

        // ⭐ CHECK 1: Sudah lewat jam 18:00? → TIDAK BISA ABSEN
        if (currentHour >= 18) {
          return res.status(400).json({
            error: "Absensi sudah ditutup. Waktu absen: 06:00 - 17:59",
            currentTime: currentTime,
          });
        }

        // ⭐ CHECK 2: Cek apakah sudah check-in hari ini
        const existingAttendance = await prisma.attendance.findFirst({
          where: {
            employee_id: targetEmployeeId,
            tanggal: {
              gte: new Date(today),
              lt: new Date(
                new Date(today).setDate(new Date(today).getDate() + 1)
              ),
            },
            jam_masuk: {
              not: null,
            },
          },
        });

        if (existingAttendance) {
          return res.status(400).json({
            error: "Sudah melakukan check-in hari ini.",
            attendance: existingAttendance,
          });
        }

        // ⭐ CHECK 3: Tentukan status berdasarkan waktu
        let status = "hadir";
        let keterangan = null;

        if (currentHour >= 8) {
          // Setelah jam 08:00 → Terlambat
          status = "terlambat";
          keterangan = `Terlambat check-in pada ${currentTime}`;
          console.log(`⚠️ Late check-in detected: ${currentTime}`);
        } else {
          // Sebelum jam 08:00 → Normal
          console.log(`✅ On-time check-in: ${currentTime}`);
        }

        // ⭐ CHECK 4: Cek apakah ada approved request (WFH/Hybrid)
        const approvedRequest = await prisma.attendance.findFirst({
          where: {
            employee_id: targetEmployeeId,
            tanggal: {
              gte: new Date(today),
              lt: new Date(
                new Date(today).setDate(new Date(today).getDate() + 1)
              ),
            },
            approval_status: "approved",
            jam_masuk: null,
          },
        });

        // ⭐ CREATE/UPDATE ATTENDANCE
        let attendanceRecord;

        if (approvedRequest) {
          // Update existing approved request
          attendanceRecord = await prisma.attendance.update({
            where: { attendance_id: approvedRequest.attendance_id },
            data: {
              jam_masuk: jam_masuk || currentTime,
              lokasi_masuk: lokasi_masuk || null,
              akurasi_masuk: akurasi_masuk ? parseInt(akurasi_masuk) : null,
              status: status,
              keterangan: keterangan,
              recorded_by_role: role,
            },
            include: {
              employee: true,
            },
          });

          console.log(
            `✅ Check-in successful (updated approved request) by ${role} for employee ${targetEmployeeId}`
          );
        } else {
          // Create new attendance record
          attendanceRecord = await prisma.attendance.create({
            data: {
              employee_id: targetEmployeeId,
              tanggal: new Date(today),
              jam_masuk: jam_masuk || currentTime,
              tipe_kerja: tipe_kerja || "WFO",
              lokasi_masuk: lokasi_masuk || null,
              akurasi_masuk: akurasi_masuk ? parseInt(akurasi_masuk) : null,
              status: status,
              keterangan: keterangan,
              recorded_by_role: role,
            },
            include: {
              employee: true,
            },
          });

          console.log(
            `✅ Check-in successful (new record) by ${role} for employee ${targetEmployeeId}`
          );
        }

        console.log(
          "✅ Attendance record created:",
          attendanceRecord.attendance_id
        );

        // ⭐⭐⭐ AUTO POTONGAN TERLAMBAT ⭐⭐⭐
        if (status === "terlambat") {
          await applyLateDeduction(
            targetEmployeeId,
            today,
            jam_masuk || currentTime
          );
        }

        // ⭐ RESPONSE MESSAGE
        let message = `✓ Absen Masuk berhasil pada ${currentTime}`;

        if (status === "terlambat") {
          const lateHours = currentHour - 8;
          const lateMinutes = currentMinute;

          message =
            `⚠️ Check-in berhasil (TERLAMBAT) pada ${currentTime}\n` +
            `Anda terlambat ${lateHours} jam ${lateMinutes} menit.\n` +
            `Potongan gaji: Rp ${POTONGAN_TERLAMBAT.toLocaleString()}\n` +
            `Harap datang tepat waktu besok (sebelum 08:00).`;
        }

        res.status(approvedRequest ? 200 : 201).json({
          message: message,
          status: status,
          potongan: status === "terlambat" ? POTONGAN_TERLAMBAT : 0,
          data: attendanceRecord,
        });
      } catch (error) {
        console.error("Error creating attendance:", error);
        res.status(400).json({
          error: "Gagal mencatat check-in.",
          details: error.message,
        });
      }
    }
  );

  // ✅ PUT: Check-out - ROLE-AWARE
  router.put(
    "/checkout/:id",
    authMiddleware.authenticateToken,
    async (req, res) => {
      const { id } = req.params;
      const { role, employee_id: userEmployeeId } = req.user;
      const { jam_pulang, lokasi_pulang, akurasi_pulang } = req.body;

      try {
        const existingAttendance = await prisma.attendance.findUnique({
          where: { attendance_id: parseInt(id) },
        });

        if (!existingAttendance) {
          return res
            .status(404)
            .json({ error: "Data absensi tidak ditemukan." });
        }

        const normalizedUserId = normalizeEmployeeId(userEmployeeId);

        // Karyawan hanya bisa check-out untuk diri sendiri
        if (
          role === "Karyawan" &&
          existingAttendance.employee_id !== normalizedUserId
        ) {
          return res.status(403).json({
            error: "Anda hanya dapat check-out untuk diri sendiri.",
          });
        }

        if (existingAttendance.jam_pulang) {
          return res.status(400).json({
            error: "Sudah melakukan check-out.",
          });
        }

        const updatedAttendance = await prisma.attendance.update({
          where: { attendance_id: parseInt(id) },
          data: {
            jam_pulang:
              jam_pulang ||
              new Date().toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            lokasi_pulang: lokasi_pulang || null,
            akurasi_pulang: akurasi_pulang ? parseInt(akurasi_pulang) : null,
          },
          include: {
            employee: true,
          },
        });

        console.log(`✅ Check-out successful by ${role} for ID ${id}`);
        res.json(updatedAttendance);
      } catch (error) {
        console.error("Error updating attendance:", error);
        res.status(400).json({
          error: "Gagal mencatat check-out.",
          details: error.message,
        });
      }
    }
  );

  // ✅ DELETE: Hapus absensi - HANYA ADMIN & HR
  router.delete(
    "/:id",
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      const { id } = req.params;

      try {
        const existingAttendance = await prisma.attendance.findUnique({
          where: { attendance_id: parseInt(id) },
        });

        if (!existingAttendance) {
          return res
            .status(404)
            .json({ error: "Data absensi tidak ditemukan." });
        }

        await prisma.attendance.delete({
          where: { attendance_id: parseInt(id) },
        });

        console.log(`✅ Attendance deleted by ${req.user.role} - ID: ${id}`);
        res.json({ message: "Absensi berhasil dihapus." });
      } catch (error) {
        console.error("Error deleting attendance:", error);
        res.status(400).json({
          error: "Gagal menghapus absensi.",
          details: error.message,
        });
      }
    }
  );

  // ✅ PUT: Approval status absensi - HANYA ADMIN & HR
  router.put(
    "/approval/:id",
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRole(["Admin", "HR"]),
    async (req, res) => {
      const { id } = req.params;
      const { status_approval } = req.body;

      try {
        const existingAttendance = await prisma.attendance.findUnique({
          where: { attendance_id: parseInt(id) },
        });

        if (!existingAttendance) {
          return res
            .status(404)
            .json({ error: "Data absensi tidak ditemukan." });
        }

        const approvedAttendance = await prisma.attendance.update({
          where: { attendance_id: parseInt(id) },
          data: { status_approval },
          include: {
            employee: true,
          },
        });

        console.log(`✅ Attendance approved by ${req.user.role} - ID: ${id}`);
        res.json(approvedAttendance);
      } catch (error) {
        console.error("Error approving attendance:", error);
        res.status(400).json({
          error: "Gagal memperbarui status approval absensi.",
          details: error.message,
        });
      }
    }
  );

  // ✅ GET: Absensi berdasarkan employee_id - ROLE-AWARE
  router.get(
    "/employee/:employee_id",
    authMiddleware.authenticateToken,
    async (req, res) => {
      const { employee_id } = req.params;
      const { role, employee_id: userEmployeeId } = req.user;

      try {
        const normalizedParamId = normalizeEmployeeId(employee_id);
        const normalizedUserId = normalizeEmployeeId(userEmployeeId);

        // Karyawan hanya bisa lihat data mereka sendiri
        if (role === "Karyawan" && normalizedParamId !== normalizedUserId) {
          return res.status(403).json({
            error: "Anda hanya dapat melihat data absensi diri sendiri.",
          });
        }

        const attendanceList = await prisma.attendance.findMany({
          where: { employee_id: normalizedParamId },
          orderBy: { tanggal: "desc" },
          include: {
            employee: true,
          },
        });

        console.log(
          `✅ Fetched ${attendanceList.length} records for employee ${normalizedParamId}`
        );
        res.json(attendanceList);
      } catch (error) {
        console.error("Error fetching attendance:", error);
        res.status(500).json({ error: "Gagal mengambil data absensi." });
      }
    }
  );

  return router;
};
