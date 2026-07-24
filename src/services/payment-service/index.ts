import express from 'express';
import { kafka } from '../../kafka/client';
import { TOPICS } from '../../kafka/topics';
import { pool } from '../../db/client';
import { v4 as uuidv4 } from 'uuid';

const consumer = kafka.consumer({ groupId: 'payment-service-group' });
const producer = kafka.producer();

const app = express();
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});
const PORT = process.env.PAYMENT_SERVICE_PORT || 3003;

const startWorker = async () => {
  try {
    app.listen(PORT, () => {
      console.log(`Payment Service health check listening on port ${PORT}`);
    });

    await producer.connect();
    await consumer.connect();
    console.log('Payment Service connected to Kafka');

    // Subscribe to the INVENTORY_RESERVED topic
    // We only want to charge the user AFTER inventory is successfully held!
    await consumer.subscribe({ topic: TOPICS.INVENTORY_RESERVED, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;

        const eventData = JSON.parse(message.value.toString());
        const { orderId } = eventData;

        console.log(`[Payment Service] Received reservation for order ${orderId} - initiating payment...`);

        const client = await pool.connect();
        try {
          // 1. Fetch order details from the database
          const orderResult = await client.query(
            `SELECT user_id, total_amount FROM orders WHERE id = $1`,
            [orderId]
          );

          if (orderResult.rowCount === 0) {
            console.error(`[Payment Service] Order ${orderId} not found.`);
            return;
          }

          const { user_id, total_amount } = orderResult.rows[0];

          // 2. Simulate communicating with Stripe/PayPal
          // We will artificially make 10% of payments fail to demonstrate the flow
          const isPaymentSuccessful = Math.random() > 0.1; 
          
          // Use the orderId to derive the idempotency key. 
          // If this Kafka event is processed twice, we send the SAME key to Stripe!
          const paymentIdempotencyKey = `pay-${orderId}`;
          await client.query('BEGIN');

          if (isPaymentSuccessful) {
            // Insert successful payment record
            await client.query(
              `INSERT INTO payments (order_id, user_id, amount, status, idempotency_key, provider, provider_ref)
               VALUES ($1, $2, $3, 'completed', $4, 'stripe', $5)`,
              [orderId, user_id, total_amount, paymentIdempotencyKey, `ch_${uuidv4()}`]
            );

            // Update order status
            await client.query(
              `UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1`,
              [orderId]
            );

            await client.query('COMMIT');
            console.log(`[Payment Service] Payment SUCCESS for order ${orderId}`);

            // Publish PAYMENT_PROCESSED event (Notification service will listen to this)
            await producer.send({
              topic: TOPICS.PAYMENT_PROCESSED,
              messages: [{ key: orderId, value: JSON.stringify({ orderId, userId: user_id, status: 'processed' }) }]
            });

          } else {
            // Insert failed payment record
            await client.query(
              `INSERT INTO payments (order_id, user_id, amount, status, idempotency_key, provider, failure_reason)
               VALUES ($1, $2, $3, 'failed', $4, 'stripe', 'Insufficient funds')`,
              [orderId, user_id, total_amount, paymentIdempotencyKey]
            );

            // Update order status
            await client.query(
              `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
              [orderId]
            );

            await client.query('COMMIT');
            console.log(`[Payment Service] Payment FAILED for order ${orderId}. Cancelling order.`);

            // Publish PAYMENT_FAILED event (Inventory service would listen to this to release the reserved stock!)
            await producer.send({
              topic: TOPICS.PAYMENT_FAILED,
              messages: [{ key: orderId, value: JSON.stringify({ orderId, reason: 'Payment failed' }) }]
            });
          }

        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`[Payment Service] Error processing payment for order ${orderId}:`, error);
        } finally {
          client.release();
        }
      },
    });

  } catch (error) {
    console.error('Failed to start Payment Service:', error);
    process.exit(1);
  }
};

startWorker();
