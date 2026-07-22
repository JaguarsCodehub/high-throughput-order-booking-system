import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics
const createOrderCounter = new Counter('orders_created');
const createOrderDuration = new Trend('order_creation_duration');
const createOrderErrors = new Counter('order_creation_errors');

export let options = {
  stages: [
    { duration: '30s', target: 10, name: 'Warm up - 10 VUs' },
    { duration: '1m', target: 50, name: 'Ramp up - 50 VUs' },
    { duration: '1m', target: 100, name: 'Load - 100 VUs' },
    { duration: '2m', target: 100, name: 'Sustained - 100 VUs' },
    { duration: '30s', target: 0, name: 'Ramp down' },
  ],
  thresholds: {
    http_req_duration: ['p(99)<2000'], // 99% of requests < 2s
    'orders_created': ['count>1000'], // At least 1000 successful orders
  },
};

export default function () {
  // Generate random order payload with valid UUID strings
  let payload = {
    userId: `00000000-0000-0000-0000-${String(Math.floor(Math.random() * 1000) + 1).padStart(12, '0')}`,
    items: [
      {
        productId: `00000000-0000-0000-0000-${String(Math.floor(Math.random() * 10) + 1).padStart(12, '0')}`,
        quantity: Math.floor(Math.random() * 5) + 1,
        unitPrice: Math.floor(Math.random() * 500) + 10,
      },
    ],
    totalAmount: Math.floor(Math.random() * 5000) + 100,
  };

  // Make request
  let res = http.post(
    'http://localhost:30001/api/orders',
    JSON.stringify(payload),
    {
      headers: {
        'Content-Type': 'application/json',
      },
      tags: { name: 'CreateOrder' },
    }
  );

  // Track metrics
  createOrderDuration.add(res.timings.duration);

  let success = check(res, {
    'status is 201': (r) => r.status === 201,
    'order created': (r) => r.body.includes('orderId'),
  });

  if (success) {
    createOrderCounter.add(1);
  } else {
    createOrderErrors.add(1);
  }

  // Small delay between requests
  sleep(0.1);
}

// Graceful summary
export function handleSummary(data) {
  return {
    stdout: JSON.stringify(data, null, 2),
  };
}
