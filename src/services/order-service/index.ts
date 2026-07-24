import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../../db/client';
import { kafka } from '../../kafka/client';
import { TOPICS } from '../../kafka/topics';

const app = express();
app.use(express.json());

const producer = kafka.producer();
const PORT = process.env.ORDER_SERVICE_PORT || 3001;

// Health check endpoint for Kubernetes liveness/readiness probes
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('OK');
});

// Define a simple endpoint to create an order
app.post('/api/orders', async (req: Request, res: Response): Promise<void> => {
  const { userId, items, totalAmount } = req.body;
  const idempotencyKey = req.headers['x-idempotency-key'] as string || uuidv4();

  if (!userId || !items || items.length === 0) {
    res.status(400).json({ error: 'userId and items are required' });
    return;
  }

  const client = await pool.connect();

  try {
    // 1. Start a database transaction
    await client.query('BEGIN');

    // 2. Insert the order
    const orderResult = await client.query(
      `INSERT INTO orders (user_id, total_amount, idempotency_key, status) 
       VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [userId, totalAmount, idempotencyKey]
    );
    const orderId = orderResult.rows[0].id;

    // 3. Insert order items
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price) 
         VALUES ($1, $2, $3, $4)`,
        [orderId, item.productId, item.quantity, item.unitPrice]
      );
    }

    // (Optional for later) We could also insert into the outbox_events table here 
    // to implement the Transactional Outbox pattern before committing!

    await client.query('COMMIT');

    // 4. Publish the OrderCreated event to Kafka
    // We send this after the commit for simplicity in this basic setup.
    const eventPayload = {
      orderId,
      userId,
      items,
      totalAmount,
      status: 'pending',
      timestamp: new Date().toISOString(),
    };

    await producer.send({
      topic: TOPICS.ORDER_CREATED,
      messages: [
        {
          key: orderId, // Using orderId as the partition key ensures events for the same order stay ordered
          value: JSON.stringify(eventPayload),
        },
      ],
    });

    console.log(`Order ${orderId} created and event published to ${TOPICS.ORDER_CREATED}`);

    res.status(201).json({
      message: 'Order placed successfully',
      orderId,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Failed to create order:', error);

    // If it's a unique constraint violation on idempotency_key (code 23505),
    // it means we already processed this request.
    if (error.code === '23505') {
       res.status(409).json({ error: 'Order with this idempotency key already exists' });
       return;
    }

    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

const startServer = async () => {
  try {
    app.listen(PORT, () => {
      console.log(`Order Service listening on port ${PORT}`);
    });

    await producer.connect();
    console.log('Order Service Kafka Producer connected');
  } catch (error) {
    console.error('Failed to start Order Service:', error);
    process.exit(1);
  }
};

startServer();
