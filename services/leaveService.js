/**
 * ⭐ LEAVE SERVICE - Logika Kuota Cuti BULANAN
 */

/**
 * Hitung jumlah hari antara dua tanggal (termasuk hari pertama dan terakhir)
 */
function calculateLeaveDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

  return diffDays;
}

/**
 * Get current month in YYYY-MM format
 */
function getCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Cek apakah perlu reset kuota (ganti bulan)
 */
async function checkAndResetMonthlyQuota(prisma, employeeId) {
  const currentMonth = getCurrentMonth();

  const employee = await prisma.employee.findUnique({
    where: { employee_id: parseInt(employeeId) },
    select: {
      current_month: true,
      monthly_leave_quota: true,
      used_leave_days_this_month: true,
      nama_lengkap: true,
    },
  });

  if (!employee) {
    throw new Error("Karyawan tidak ditemukan.");
  }

  // Jika bulan berbeda, reset kuota
  if (employee.current_month !== currentMonth) {
    console.log(`🔄 Resetting monthly quota for ${employee.nama_lengkap}`);
    console.log(`   - Old month: ${employee.current_month}`);
    console.log(`   - New month: ${currentMonth}`);

    await prisma.employee.update({
      where: { employee_id: parseInt(employeeId) },
      data: {
        current_month: currentMonth,
        used_leave_days_this_month: 0,
      },
    });

    return {
      quota: employee.monthly_leave_quota,
      used: 0,
      remaining: employee.monthly_leave_quota,
      wasReset: true,
    };
  }

  return {
    quota: employee.monthly_leave_quota,
    used: employee.used_leave_days_this_month,
    remaining:
      employee.monthly_leave_quota - employee.used_leave_days_this_month,
    wasReset: false,
  };
}

/**
 * Cek kuota cuti bulan ini
 */
async function checkLeaveQuota(prisma, employeeId, requestedDays) {
  // Reset jika bulan baru
  const quotaInfo = await checkAndResetMonthlyQuota(prisma, employeeId);

  return {
    quota: quotaInfo.quota,
    used: quotaInfo.used,
    remaining: quotaInfo.remaining,
    requested: requestedDays,
    sufficient: quotaInfo.remaining >= requestedDays,
    month: getCurrentMonth(),
  };
}

/**
 * Hitung total hari cuti approved untuk bulan ini
 */
async function getApprovedLeaveDaysThisMonth(prisma, employeeId) {
  const currentMonth = getCurrentMonth();
  const [year, month] = currentMonth.split("-");

  const startOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
  const endOfMonth = new Date(parseInt(year), parseInt(month), 0);

  const approvedLeaves = await prisma.leaveRequest.findMany({
    where: {
      employee_id: parseInt(employeeId),
      status: "approved",
      jenis_pengajuan: "Cuti",
      tanggal_mulai: {
        gte: startOfMonth,
        lte: endOfMonth,
      },
    },
    select: {
      total_days: true,
    },
  });

  const totalDays = approvedLeaves.reduce(
    (sum, leave) => sum + leave.total_days,
    0
  );
  return totalDays;
}

/**
 * Update kuota cuti karyawan setelah approved
 */
async function updateEmployeeLeaveQuota(prisma, employeeId, additionalDays) {
  // Reset jika bulan baru
  await checkAndResetMonthlyQuota(prisma, employeeId);

  const employee = await prisma.employee.findUnique({
    where: { employee_id: parseInt(employeeId) },
    select: {
      used_leave_days_this_month: true,
      monthly_leave_quota: true,
    },
  });

  if (!employee) {
    throw new Error("Karyawan tidak ditemukan.");
  }

  const newUsedDays = employee.used_leave_days_this_month + additionalDays;

  if (newUsedDays > employee.monthly_leave_quota) {
    throw new Error("Kuota cuti bulan ini tidak mencukupi.");
  }

  await prisma.employee.update({
    where: { employee_id: parseInt(employeeId) },
    data: {
      used_leave_days_this_month: newUsedDays,
    },
  });
}

/**
 * Kembalikan kuota jika cuti dibatalkan/ditolak
 */
async function restoreLeaveQuota(prisma, employeeId, days) {
  const employee = await prisma.employee.findUnique({
    where: { employee_id: parseInt(employeeId) },
    select: {
      used_leave_days_this_month: true,
      current_month: true,
    },
  });

  if (!employee) {
    throw new Error("Karyawan tidak ditemukan.");
  }

  // Hanya restore jika masih di bulan yang sama
  const currentMonth = getCurrentMonth();
  if (employee.current_month === currentMonth) {
    const newUsedDays = Math.max(0, employee.used_leave_days_this_month - days);

    await prisma.employee.update({
      where: { employee_id: parseInt(employeeId) },
      data: {
        used_leave_days_this_month: newUsedDays,
      },
    });
  } else {
    console.log("⚠️ Cannot restore quota - different month");
  }
}

module.exports = {
  calculateLeaveDays,
  getCurrentMonth,
  checkAndResetMonthlyQuota,
  checkLeaveQuota,
  getApprovedLeaveDaysThisMonth,
  updateEmployeeLeaveQuota,
  restoreLeaveQuota,
};
