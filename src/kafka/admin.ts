// src/kafka/admin.ts
// Admin client for programmatic topic management (list, describe, delete)

import { kafka } from './client';
import { TOPICS } from './topics';

export const createTopics = async () => {
  const admin = kafka.admin();

  try {
    console.log('Connecting Admin...');
    await admin.connect();
    console.log('Admin connected successfully!');

    const existingTopics = await admin.listTopics();
    console.log('Existing topics:', existingTopics);

    const topicsToCreate = Object.values(TOPICS)
      .filter((topic) => !existingTopics.includes(topic))
      .map((topic) => ({
        topic,
        numPartitions: 1, // Single partition is fine for local dev
        replicationFactor: 1, // Must be 1 since we have 1 broker
      }));

    if (topicsToCreate.length > 0) {
      console.log('Creating topics:', topicsToCreate.map(t => t.topic));
      await admin.createTopics({
        topics: topicsToCreate,
      });
      console.log('Topics created successfully!');
    } else {
      console.log('All topics already exist.');
    }
  } catch (error) {
    console.error('Failed to create topics:', error);
  } finally {
    await admin.disconnect();
    console.log('Admin disconnected.');
  }
};

// If this file is executed directly (e.g. `npx ts-node src/kafka/admin.ts`)
if (require.main === module) {
  createTopics().catch(console.error);
}
