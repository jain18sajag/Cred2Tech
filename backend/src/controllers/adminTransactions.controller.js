const adminTransactionsService = require('../services/adminTransactions.service');

async function list(req, res) {
  try {
    const result = await adminTransactionsService.list(req.query);
    res.json(result);
  } catch (error) {
    console.error('adminTransactions.list error:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
}

async function summary(req, res) {
  try {
    const result = await adminTransactionsService.summary(req.query);
    res.json(result);
  } catch (error) {
    console.error('adminTransactions.summary error:', error);
    res.status(500).json({ error: 'Failed to fetch transaction summary' });
  }
}

async function exportExcel(req, res) {
  try {
    const wb = await adminTransactionsService.buildExcelWorkbook(req.query);
    const buffer = await wb.xlsx.writeBuffer();
    const fileName = `Cred2Tech_Transactions_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    console.error('adminTransactions.exportExcel error:', error);
    res.status(500).json({ error: 'Failed to export transactions' });
  }
}

async function exportPdf(req, res) {
  try {
    const fileName = `Cred2Tech_Transactions_${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await adminTransactionsService.streamPdfReport(req.query, res);
  } catch (error) {
    console.error('adminTransactions.exportPdf error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export transactions' });
    }
  }
}

module.exports = {
  list,
  summary,
  exportExcel,
  exportPdf,
};
