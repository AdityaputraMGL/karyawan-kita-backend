const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function fixLeaveQuota() {
  try {
    console.log("🔄 Fixing leave quota for all employees...\n");

    // 1. Reset semua kuota
    await prisma.employee.updateMany({
      data: {
        used_leave_days: 0,
        current_year: 2025,
      },
    });
    console.log("✅ Reset all quotas to 0\n");

    // 2. Get semua karyawan
    const employees = await prisma.employee.findMany({
      select: {
        employee_id: true,
        nama_lengkap: true,
        annual_leave_quota: true,
      },
    });

    console.log(`📋 Processing ${employees.length} employees...\n`);

    // 3. Untuk setiap karyawan, hitung total cuti approved
    for (const emp of employees) {
      const approvedLeaves = await prisma.leaveRequest.findMany({
        where: {
          employee_id: emp.employee_id,
          status: "approved",
          jenis_pengajuan: "Cuti",
          tanggal_mulai: {
            gte: new Date("2025-01-01"),
            lte: new Date("2025-12-31"),
          },
        },
        select: {
          total_days: true,
        },
      });

      const totalUsed = approvedLeaves.reduce(
        (sum, leave) => sum + leave.total_days,
        0
      );

      if (totalUsed > 0) {
        await prisma.employee.update({
          where: { employee_id: emp.employee_id },
          data: { used_leave_days: totalUsed },
        });

        console.log(`👤 ${emp.nama_lengkap} (ID: ${emp.employee_id})`);
        console.log(`   - Quota: ${emp.annual_leave_quota} days`);
        console.log(`   - Used: ${totalUsed} days`);
        console.log(
          `   - Remaining: ${emp.annual_leave_quota - totalUsed} days`
        );
        console.log("");
      }
    }

    console.log("✅ All quotas updated successfully!");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

fixLeaveQuota();
