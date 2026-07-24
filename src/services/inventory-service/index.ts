import express from 'express';
import { kafka } from '../../kafka/client';
import { TOPICS } from '../../kafka/topics';
import { pool } from '../../db/client';

const consumer = kafka.consumer({ groupId: 'inventory-service-group' });
const producer = kafka.producer();

const app = express();
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});
const PORT = process.env.INVENTORY_SERVICE_PORT || 3002;

const startWorker = async () => {
  try {
    app.listen(PORT, () => {
      console.log(`Inventory Service health check listening on port ${PORT}`);
    });

    // 1. Connect to Kafka
    await producer.connect();
    await consumer.connect();
    console.log('Inventory Service connected to Kafka');

    // 2. Subscribe to BOTH topics for the Saga
    await consumer.subscribe({ topic: TOPICS.ORDER_CREATED, fromBeginning: false });
    await consumer.subscribe({ topic: TOPICS.PAYMENT_FAILED, fromBeginning: false });

    // 3. Start listening for messages
    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return;

        const eventData = JSON.parse(message.value.toString());
        const client = await pool.connect();

        try {
          await client.query('BEGIN');

          // ==========================================
          // SCENARIO A: New Order -> Reserve Stock
          // ==========================================
          if (topic === TOPICS.ORDER_CREATED) {
            const { orderId, items } = eventData;
            console.log(`[Inventory Service] Received order ${orderId} - reserving inventory...`);

            let isStockAvailable = true;

            for (const item of items) {
              const updateResult = await client.query(
                `UPDATE inventory 
                 SET reserved = reserved + $1, updated_at = NOW()
                 WHERE product_id = $2 
                   AND (quantity - reserved) >= $1
                 RETURNING id`,
                [item.quantity, item.productId]
              );

              if (updateResult.rowCount === 0) {
                isStockAvailable = false;
                break; 
              }
            }

            if (isStockAvailable) {
              await client.query('COMMIT');
              console.log(`[Inventory Service] Inventory successfully reserved for order ${orderId}`);
              
              await producer.send({
                topic: TOPICS.INVENTORY_RESERVED,
                messages: [{ key: orderId, value: JSON.stringify({ orderId, status: 'reserved' }) }]
              });
              
            } else {
              await client.query('ROLLBACK');
              console.log(`[Inventory Service] OUT OF STOCK for order ${orderId}. Rolling back.`);
              
              await producer.send({
                topic: TOPICS.INVENTORY_FAILED,
                messages: [{ key: orderId, value: JSON.stringify({ orderId, reason: 'Out of stock' }) }]
              });
            }
          } 
          
          // ==========================================
          // SCENARIO B: Payment Failed -> Release Stock (Compensating Transaction)
          // ==========================================
          else if (topic === TOPICS.PAYMENT_FAILED) {
            const { orderId } = eventData;
            console.log(`[Inventory Service] Payment failed for order ${orderId} - releasing reserved inventory...`);

            // Fetch the items that were in this order
            const orderItemsResult = await client.query(
              `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
              [orderId]
            );

            // Release the hold on each item
            for (const item of orderItemsResult.rows) {
              await client.query(
                `UPDATE inventory 
                 SET reserved = reserved - $1, updated_at = NOW()
                 WHERE product_id = $2`,
                [item.quantity, item.product_id]
              );
            }

            await client.query('COMMIT');
            console.log(`[Inventory Service] Successfully released inventory hold for order ${orderId}`);
          }

        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`[Inventory Service] Error processing event:`, error);
        } finally {
          client.release();
        }
      },
    });

  } catch (error) {
    console.error('Failed to start Inventory Service:', error);
    process.exit(1);
  }
};

startWorker();
