const esrService = require('../services/esr.service');

async function generate(req, res) {
  try {
    _setNoStoreHeaders(res);
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
    _setNoStoreHeaders(res);
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

async function recalculate(req, res) {
  try {
    _setNoStoreHeaders(res);
    const caseId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const result = await esrService.recalculateESR(caseId, userId, req.user.tenant_id);
    const scrubbedResult = _scrubESRResult(result, req.user.role);
    res.json(scrubbedResult);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to recalculate ESR.' });
  }
}

async function listLogs(req, res) {
  try {
    _setNoStoreHeaders(res);
    const caseId = parseInt(req.params.id, 10);
    const result = await esrService.listESRLogs(caseId, req.user.tenant_id);
    res.json(result);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch ESR logs.' });
  }
}

async function getLog(req, res) {
  try {
    _setNoStoreHeaders(res);
    const caseId = parseInt(req.params.id, 10);
    const result = await esrService.getESRLog(caseId, req.user.tenant_id, req.params.calculationRunId);
    res.json(result);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch ESR log.' });
  }
}

async function downloadLog(req, res) {
  try {
    _setNoStoreHeaders(res);
    const caseId = parseInt(req.params.id, 10);
    const file = await esrService.downloadESRLog(
      caseId,
      req.user.tenant_id,
      req.params.calculationRunId,
      req.query.format || 'json'
    );
    res.setHeader('Content-Type', file.contentType);
    if (file.stream) {
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      return file.stream.pipe(res);
    }
    res.download(file.filePath, file.fileName);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    if (err.message.includes('Unsupported')) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to download ESR log.' });
  }
}

function _setNoStoreHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

module.exports = {
  generate,
  get,
  recalculate,
  listLogs,
  getLog,
  downloadLog
};
