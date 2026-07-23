import express from 'express';
import { kafka } from '../../kafka/client';
import { TOPICS } from '../../kafka/topics';
import { pool } from '../../db/client';

const consumer = kafka.consumer({ groupId: 'notification-service-group' });

const app = express();
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});
const PORT = process.env.NOTIFICATION_SERVICE_PORT || 3004;

const startWorker = async () => {
  try {
    app.listen(PORT, () => {
      console.log(`Notification Service health check listening on port ${PORT}`);
    });

    await consumer.connect();
    console.log('Notification Service connected to Kafka');

    // Subscribe to payment success and failure events
    await consumer.subscribe({ topic: TOPICS.PAYMENT_PROCESSED, fromBeginning: false });
    await consumer.subscribe({ topic: TOPICS.PAYMENT_FAILED, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return;

        const eventData = JSON.parse(message.value.toString());
        const { orderId } = eventData;
        
        // Sometimes the event might not include userId (e.g. PAYMENT_FAILED from our earlier code)
        // So we will just query the DB for the user info based on the order ID.
        
        const client = await pool.connect();
        
        try {
          const userResult = await client.query(
            `SELECT u.id as user_id, u.email, u.full_name 
             FROM orders o 
             JOIN users u ON o.user_id = u.id 
             WHERE o.id = $1`,
            [orderId]
          );

          if (userResult.rowCount === 0) {
            console.error(`[Notification Service] Could not find user for order ${orderId}`);
            return;
          }

          const user = userResult.rows[0];

          let subject = '';
          let body = '';

          if (topic === TOPICS.PAYMENT_PROCESSED) {
            subject = 'Your Order is Confirmed!';
            body = `Hello ${user.full_name}, your payment was successful and your order ${orderId} is being prepared!`;
            console.log(`[Notification Service] Sending SUCCESS Email to ${user.email} for order ${orderId}`);
          } else if (topic === TOPICS.PAYMENT_FAILED) {
            subject = 'Payment Failed for Your Order';
            body = `Hello ${user.full_name}, unfortunately your payment failed for order ${orderId}. Your order has been cancelled.`;
            console.log(`[Notification Service] Sending FAILURE Email to ${user.email} for order ${orderId}`);
          }

          // Insert into notifications table
          await client.query(
            `INSERT INTO notifications (user_id, order_id, channel, status, subject, body, sent_at)
             VALUES ($1, $2, 'email', 'sent', $3, $4, NOW())`,
            [user.user_id, orderId, subject, body]
          );

        } catch (error) {
          console.error(`[Notification Service] Error sending notification for order ${orderId}:`, error);
        } finally {
          client.release();
        }
      },
    });

  } catch (error) {
    console.error('Failed to start Notification Service:', error);
    process.exit(1);
  }
};

startWorker();
