const prisma = require('../../config/db');
const razorpayService = require('../services/razorpay.service');
const walletService = require('../services/wallet.service');

async function handleRazorpayWebhook(req, res) {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.body;

    if (!signature) {
      return res.status(400).send('Missing signature');
    }

    const isValid = razorpayService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      return res.status(400).send('Invalid signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventType = payload.event;
    const eventId = req.headers['x-razorpay-event-id'];

    if (!eventId) {
      return res.status(400).send('Missing event ID');
    }

    // Deduplication via RazorpayWebhookEvent
    try {
      await prisma.razorpayWebhookEvent.create({
        data: {
          razorpay_event_id: eventId,
          event_type: eventType,
          raw_payload: payload,
        }
      });
    } catch (dbError) {
      if (dbError.code === 'P2002') {
        // A row for this event ID already exists — but that only means a
        // PRIOR delivery reached this point, not that it finished. If the
        // process crashed/errored between here and the `processed: true`
        // update below (e.g. mid wallet-credit), short-circuiting on the row's
        // mere existence would ack Razorpay with 200 and silently drop the
        // credit forever, since Razorpay never retries a 200. Only skip
        // reprocessing when `processed` is actually true.
        const existing = await prisma.razorpayWebhookEvent.findUnique({ where: { razorpay_event_id: eventId } });
        if (existing?.processed) {
          return res.status(200).send('Event already processed');
        }
        // else: fall through and reprocess — all downstream steps below are
        // themselves idempotent (status-checked topup updates, dedup'd wallet credit).
      } else {
        throw dbError; // unexpected db error
      }
    }

    const paymentEntity = payload.payload.payment.entity;
    const orderId = paymentEntity.order_id;
    const paymentId = paymentEntity.id;

    // Update webhook event row with identifiers
    await prisma.razorpayWebhookEvent.update({
      where: { razorpay_event_id: eventId },
      data: { razorpay_order_id: orderId, razorpay_payment_id: paymentId }
    });

    if (eventType === 'payment.captured') {
      const topup = await prisma.walletTopupRequest.findUnique({
        where: { razorpay_order_id: orderId }
      });

      if (topup && topup.status !== 'CREDITED') {
        try {
          await walletService.creditWalletForRazorpayTopup(topup.id, paymentEntity, eventId);
        } catch (creditError) {
          console.error(`Failed to credit wallet for topup ${topup.id}:`, creditError.message);
          await prisma.walletTopupRequest.update({
            where: { id: topup.id },
            data: { status: 'FAILED', failure_reason: creditError.message, failed_at: new Date() }
          });
        }
      }
    } else if (eventType === 'payment.failed') {
      const topup = await prisma.walletTopupRequest.findUnique({
        where: { razorpay_order_id: orderId }
      });
      if (topup && topup.status !== 'CREDITED') {
        await prisma.walletTopupRequest.update({
          where: { id: topup.id },
          data: { 
            status: 'FAILED', 
            failure_code: paymentEntity.error_code, 
            failure_reason: paymentEntity.error_description, 
            failed_at: new Date() 
          }
        });
      }
    } else if (eventType.startsWith('refund.')) {
      const topup = await prisma.walletTopupRequest.findFirst({
        where: { razorpay_payment_id: paymentId } // refunds don't always have order_id readily accessible
      });
      if (topup) {
        await prisma.walletTopupRequest.update({
          where: { id: topup.id },
          data: { status: 'REFUND_REVIEW_REQUIRED' }
        });
      }
    }

    // Mark event processed
    await prisma.razorpayWebhookEvent.update({
      where: { razorpay_event_id: eventId },
      data: { processed: true, processed_at: new Date() }
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Razorpay Webhook Error:', error);
    res.status(500).send('Internal Server Error');
  }
}

module.exports = {
  handleRazorpayWebhook
};
