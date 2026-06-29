// src/kafka/client.ts
// KafkaJS client singleton — import this everywhere you need a producer or consumer

import { Kafka, logLevel} from 'kafkajs'
import dotenv from 'dotenv'

dotenv.config()

const brokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092']

export const kafka = new Kafka({
  clientId: 'order-booking-system',
  brokers,
  logLevel: logLevel.INFO,
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
})
