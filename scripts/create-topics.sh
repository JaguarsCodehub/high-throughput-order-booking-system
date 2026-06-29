#!/bin/bash

# ─────────────────────────────────────────────────────────────
#  create-topics.sh
#  Run after Kafka is healthy:  bash scripts/create-topics.sh
# ─────────────────────────────────────────────────────────────

KAFKA_CONTAINER="kafka"
PARTITIONS=3
REPLICATION=1

# DLQ topics use 1 partition — easier to reason about failed events
DLQ_PARTITIONS=1

# Retention: main topics 7 days, DLQ topics 30 days (ms)
MAIN_RETENTION_MS=604800000
DLQ_RETENTION_MS=2592000000

echo "⏳  Waiting for Kafka to be ready..."
sleep 5

create_topic() {
  local TOPIC=$1
  local PARTS=$2
  local RETENTION=$3

  docker exec $KAFKA_CONTAINER kafka-topics \
    --bootstrap-server localhost:9092 \
    --create \
    --if-not-exists \
    --topic "$TOPIC" \
    --partitions "$PARTS" \
    --replication-factor $REPLICATION \
    --config retention.ms="$RETENTION" \
    --config cleanup.policy=delete

  echo "✅  Created: $TOPIC (partitions=$PARTS, retention=${RETENTION}ms)"
}

echo ""
echo "─── Order Topics ──────────────────────────────────────"
create_topic "order.created"         $PARTITIONS     $MAIN_RETENTION_MS
create_topic "order.created.dlq"     $DLQ_PARTITIONS $DLQ_RETENTION_MS
create_topic "order.cancelled"       $PARTITIONS     $MAIN_RETENTION_MS
create_topic "order.cancelled.dlq"   $DLQ_PARTITIONS $DLQ_RETENTION_MS

echo ""
echo "─── Inventory Topics ──────────────────────────────────"
create_topic "inventory.reserved"       $PARTITIONS     $MAIN_RETENTION_MS
create_topic "inventory.reserved.dlq"   $DLQ_PARTITIONS $DLQ_RETENTION_MS
create_topic "inventory.released"       $PARTITIONS     $MAIN_RETENTION_MS
create_topic "inventory.released.dlq"   $DLQ_PARTITIONS $DLQ_RETENTION_MS

echo ""
echo "─── Payment Topics ────────────────────────────────────"
create_topic "payment.processed"      $PARTITIONS     $MAIN_RETENTION_MS
create_topic "payment.processed.dlq"  $DLQ_PARTITIONS $DLQ_RETENTION_MS
create_topic "payment.failed"         $PARTITIONS     $MAIN_RETENTION_MS
create_topic "payment.failed.dlq"     $DLQ_PARTITIONS $DLQ_RETENTION_MS

echo ""
echo "─── Notification Topics ───────────────────────────────"
create_topic "notification.send"      $PARTITIONS     $MAIN_RETENTION_MS
create_topic "notification.send.dlq"  $DLQ_PARTITIONS $DLQ_RETENTION_MS

echo ""
echo "📋  All topics:"
docker exec $KAFKA_CONTAINER kafka-topics \
  --bootstrap-server localhost:9092 \
  --list

echo ""
echo "🎉  Done."
