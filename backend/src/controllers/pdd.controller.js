const pddService = require('../services/pdd.service');

async function getPddTasks(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const { status, search, case_id, customer_id, overdue, page, limit } = req.query;

    const result = await pddService.listPddTasks(req.user, {
      status, search, case_id, customer_id, overdue,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20
    });

    res.json({
      success: true,
      summary: result.summary,
      data: result.data
    });
  } catch (error) {
    console.error('[PDD Controller] Error fetching tasks:', error);
    res.status(500).json({ error: 'Internal server error while fetching PDD tasks.' });
  }
}

async function updateStatus(req, res) {
  try {
    const pddId = parseInt(req.params.id, 10);
    const tenant_id = req.user.tenant_id;
    const userId = req.user.id;
    
    // Resolve role name safely matching how it's handled across the app
    const userRole = req.user?.role?.name || req.user?.role || req.user?.role_name;

    const { status, collection_date, collected_by, waiver_reason, remarks } = req.body;

    // Map UI "COLLECTED" to Backend "RECEIVED"
    const normalizedStatus = status === 'COLLECTED' ? 'RECEIVED' : status;

    if (!['PENDING', 'RECEIVED', 'WAIVED'].includes(normalizedStatus)) {
      return res.status(400).json({ error: 'Invalid status. Must be PENDING, COLLECTED, or WAIVED.' });
    }

    // Role Validations
    if (normalizedStatus === 'WAIVED' && userRole !== 'DSA_ADMIN' && userRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Only administrators can waive PDD tasks.' });
    }

    // Payload Validations
    if (normalizedStatus === 'RECEIVED' && !collection_date) {
      return res.status(400).json({ error: 'collection_date is required when marking as Collected.' });
    }
    if (normalizedStatus === 'WAIVED' && !waiver_reason) {
      return res.status(400).json({ error: 'waiver_reason is required when marking as Waived.' });
    }

    // Default collected_by to current user's name if empty (we don't have the user's name easily in req.user, so pass userId and let service resolve if needed, or just use the ID string)
    // Actually, req.user is just { id, role, tenant_id }. 
    // We'll pass collected_by or stringified userId to service.

    const updatedTask = await pddService.updatePddStatus(pddId, tenant_id, userId, {
      status: normalizedStatus,
      collection_date,
      collected_by,
      waiver_reason,
      remarks
    });

    res.json({
      success: true,
      data: updatedTask
    });
  } catch (error) {
    if (error.message === 'PDD Task not found or unauthorized.') {
      return res.status(404).json({ error: error.message });
    }
    console.error('[PDD Controller] Error updating status:', error);
    res.status(500).json({ error: 'Internal server error while updating PDD task status.' });
  }
}

module.exports = {
  getPddTasks,
  updateStatus
};
