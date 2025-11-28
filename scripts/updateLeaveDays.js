/**
 * Script untuk update total_days pada leave_requests yang sudah ada
 * Jalankan: node scripts/updateLeaveDays.js
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function calculateLeaveDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

  return diffDays;
}

async function updateExistingLeaveRequests() {
  try {
    console.log("🔄 Starting update of existing leave requests...\n");

    // Ambil semua leave requests yang total_days-nya 0 atau null
    const leaveRequests = await prisma.leaveRequest.findMany({
      where: {
        OR: [{ total_days: 0 }, { total_days: null }],
      },
      select: {
        leave_id: true,
        tanggal_mulai: true,
        tanggal_selesai: true,
        jenis_pengajuan: true,
        status: true,
        employee_id: true,
      },
    });

    console.log(`📋 Found ${leaveRequests.length} leave requests to update\n`);

    let updated = 0;
    let quotaUpdates = [];

    for (const leave of leaveRequests) {
      const totalDays = calculateLeaveDays(
        leave.tanggal_mulai,
        leave.tanggal_selesai
      );

      console.log(`✏️  Leave ID ${leave.leave_id}:`);
      console.log(
        `   - From: ${leave.tanggal_mulai.toISOString().split("T")[0]}`
      );
      console.log(
        `   - To: ${leave.tanggal_selesai.toISOString().split("T")[0]}`
      );
      console.log(`   - Days: ${totalDays}`);
      console.log(`   - Type: ${leave.jenis_pengajuan}`);
      console.log(`   - Status: ${leave.status}`);

      // Update total_days di leave_request
      await prisma.leaveRequest.update({
        where: { leave_id: leave.leave_id },
        data: { total_days: totalDays },
      });

      // Jika status approved dan jenis Cuti, kumpulkan data untuk update kuota
      if (leave.status === "approved" && leave.jenis_pengajuan === "Cuti") {
        const existing = quotaUpdates.find(
          (q) => q.employee_id === leave.employee_id
        );
        if (existing) {
          existing.total_days += totalDays;
        } else {
          quotaUpdates.push({
            employee_id: leave.employee_id,
            total_days: totalDays,
          });
        }
        console.log(
          `   ⚠️  This is APPROVED Cuti - will update employee quota`
        );
      }

      updated++;
      console.log("   ✅ Updated\n");
    }

    // Update kuota karyawan berdasarkan cuti yang approved
    if (quotaUpdates.length > 0) {
      console.log("\n📊 Updating employee quotas...\n");

      for (const update of quotaUpdates) {
        const employee = await prisma.employee.findUnique({
          where: { employee_id: update.employee_id },
          select: {
            nama_lengkap: true,
            used_leave_days: true,
            annual_leave_quota: true,
          },
        });

        if (employee) {
          const newUsedDays = employee.used_leave_days + update.total_days;

          await prisma.employee.update({
            where: { employee_id: update.employee_id },
            data: { used_leave_days: newUsedDays },
          });

          console.log(`👤 ${employee.nama_lengkap}:`);
          console.log(`   - Previous used: ${employee.used_leave_days} days`);
          console.log(`   - Added: ${update.total_days} days`);
          console.log(`   - New used: ${newUsedDays} days`);
          console.log(
            `   - Remaining: ${employee.annual_leave_quota - newUsedDays} days`
          );
          console.log("   ✅ Updated\n");
        }
      }
    }

    console.log(`\n✅ Successfully updated ${updated} leave requests`);
    console.log(`✅ Updated quota for ${quotaUpdates.length} employees`);
  } catch (error) {
    console.error("❌ Error updating leave requests:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// Jalankan script
updateExistingLeaveRequests();
