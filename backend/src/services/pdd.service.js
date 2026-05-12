const prisma = require('../../config/db');

async function listPddTasks(tenantId, filters) {
  const { status, search, case_id, customer_id, overdue, page, limit } = filters;

  const whereClause = {
    tenant_id: tenantId
  };

  if (status && status !== 'ALL') {
    whereClause.status = status === 'COLLECTED' ? 'RECEIVED' : status;
  }

  if (case_id) {
    whereClause.case_id = parseInt(case_id, 10);
  }

  // Handle Search: customer name, mobile, case_id, document name
  if (search) {
    const searchInt = parseInt(search, 10);
    whereClause.OR = [
      { document_name: { contains: search, mode: 'insensitive' } },
      { case_entity: { customer: { business_name: { contains: search, mode: 'insensitive' } } } },
      { case_entity: { customer: { first_name: { contains: search, mode: 'insensitive' } } } },
      { case_entity: { customer: { mobile: { contains: search } } } }
    ];
    if (!isNaN(searchInt)) {
      whereClause.OR.push({ case_id: searchInt });
    }
  }

  if (customer_id) {
    whereClause.case_entity = { ...whereClause.case_entity, customer_id: parseInt(customer_id, 10) };
  }

  if (overdue === 'true') {
    whereClause.status = 'PENDING';
    whereClause.due_date = { lt: new Date() };
  }

  // Fetch paginated records
  const skip = (page - 1) * limit;
  const tasks = await prisma.pDDTask.findMany({
    where: whereClause,
    include: {
      case_entity: {
        include: {
          customer: true,
          created_by: true // employee
        }
      }
    },
    // Default sorting logic: Overdue pending first, then due_date asc, then case_id desc
    orderBy: [
      { status: 'asc' }, // PENDING (P) comes before RECEIVED (R) and WAIVED (W)
      { due_date: 'asc' },
      { case_id: 'desc' }
    ],
    skip,
    take: limit
  });

  // Calculate summaries (need to query without pagination filters but with tenant_id)
  const allTenantTasks = await prisma.pDDTask.findMany({
    where: { tenant_id: tenantId },
    select: { status: true, due_date: true }
  });

  const now = new Date();
  let total = 0, pending = 0, received = 0, waived = 0, overdueCount = 0;

  allTenantTasks.forEach(task => {
    total++;
    if (task.status === 'PENDING') {
      pending++;
      if (task.due_date && new Date(task.due_date) < now) {
        overdueCount++;
      }
    } else if (task.status === 'RECEIVED') {
      received++;
    } else if (task.status === 'WAIVED') {
      waived++;
    }
  });

  // Map to final response structure
  const formattedData = tasks.map(task => {
    const c = task.case_entity;
    const cust = c?.customer || {};
    const emp = c?.created_by || {};
    
    // Evaluate overdue status dynamically
    const is_overdue = task.status === 'PENDING' && task.due_date && new Date(task.due_date) < now;

    return {
      pdd_task_id: task.id,
      case_id: task.case_id,
      case_code: `CASE-${task.case_id}`,
      customer_id: cust.id,
      customer_name: cust.business_name || `${cust.first_name || ''} ${cust.last_name || ''}`.trim(),
      customer_mobile: cust.mobile,
      loan_amount: c?.sanctioned_amount || c?.loan_amount,
      employee_name: emp.name || 'N/A',
      document_name: task.document_name,
      due_date: task.due_date,
      status: task.status,
      is_overdue,
      collection_date: task.collection_date,
      collected_by: task.collected_by,
      waiver_reason: task.waiver_reason,
      remarks: task.remarks
    };
  });

  // Overdue pending first sort explicitly since Prisma orderBy struggles with complex computed conditions
  formattedData.sort((a, b) => {
    if (a.is_overdue && !b.is_overdue) return -1;
    if (!a.is_overdue && b.is_overdue) return 1;
    return 0; // fallback to prisma's order
  });

  return {
    summary: {
      total,
      pending,
      received,
      collected: received, // UI alias
      waived,
      overdue: overdueCount
    },
    data: formattedData
  };
}

async function updatePddStatus(pddId, tenantId, userId, updateData) {
  return await prisma.$transaction(async (tx) => {
    const task = await tx.pDDTask.findFirst({
      where: { id: pddId, tenant_id: tenantId },
      include: {
        case_entity: true
      }
    });

    if (!task) {
      throw new Error('PDD Task not found or unauthorized.');
    }

    const oldStatus = task.status;
    const newStatus = updateData.status;

    let payload = {
      status: newStatus,
      remarks: updateData.remarks !== undefined ? updateData.remarks : task.remarks
    };

    if (newStatus === 'RECEIVED') {
      payload.collection_date = new Date(updateData.collection_date);
      
      // If collected_by is empty, fetch user's name
      if (!updateData.collected_by) {
        const user = await tx.user.findUnique({ where: { id: userId } });
        payload.collected_by = user ? user.name : `User ${userId}`;
      } else {
        payload.collected_by = updateData.collected_by;
      }
      
      // Clear waiver reason if reverting from waived
      payload.waiver_reason = null;
    } else if (newStatus === 'WAIVED') {
      payload.waiver_reason = updateData.waiver_reason;
      payload.collection_date = null;
      payload.collected_by = null;
    } else if (newStatus === 'PENDING') {
      payload.collection_date = null;
      payload.collected_by = null;
      payload.waiver_reason = null;
    }

    const updatedTask = await tx.pDDTask.update({
      where: { id: pddId },
      data: payload
    });

    // Activity Log / Audit Log
    await tx.activityLog.create({
      data: {
        case_id: task.case_id,
        customer_id: task.case_entity?.customer_id || null,
        activity_type: 'PDD_STATUS_UPDATED',
        description: `PDD document '${task.document_name}' status changed from ${oldStatus} to ${newStatus}.`,
        performed_by_user_id: userId
      }
    });

    return updatedTask;
  });
}

module.exports = {
  listPddTasks,
  updatePddStatus
};
