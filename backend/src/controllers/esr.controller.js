const esrService = require('../services/esr.service');

async function generate(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const result = await esrService.generateESR(caseId, userId, req.user.tenant_id);
    const scrubbedResult = _scrubESRResult(result, req.user.role);
    res.json(scrubbedResult);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to generate ESR.' });
  }
}

function _scrubESRResult(result, userRole) {
  if (userRole === 'SUPER_ADMIN' || userRole === 'PLATFORM_ADMIN') return result;

  if (result && Array.isArray(result.lenders)) {
    result.lenders = result.lenders.map(lender => {
      const scrubbed = { ...lender };
      
      if (scrubbed.scheme_evaluations && Array.isArray(scrubbed.scheme_evaluations)) {
        scrubbed.scheme_evaluations = scrubbed.scheme_evaluations.map(evalItem => {
          const newEval = { ...evalItem };
          // Remove raw formulas and internal analytics
          delete newEval.formula;
          delete newEval.calculation_log;
          delete newEval.internal_analytics;
          
          if (newEval.components) {
            delete newEval.components.raw_data;
          }
          return newEval;
        });
      }
      
      delete scrubbed.rejection_reasons_internal; // if any
      return scrubbed;
    });
  }
  return result;
}

async function get(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const result = await esrService.getESR(caseId, req.user.tenant_id);
    const scrubbedResult = _scrubESRResult(result, req.user.role);
    res.json(scrubbedResult);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    if (err.message.includes('No ESR')) return res.status(404).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch ESR.' });
  }
}

module.exports = { generate, get };
