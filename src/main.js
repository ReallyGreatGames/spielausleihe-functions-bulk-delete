import { Client, Databases } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);

  let body = req.bodyJson || {};
  const { databaseId, collectionId, documentIds } = body;

  try {
    if (!databaseId || !collectionId || !Array.isArray(documentIds)) {
      throw new Error("Missing databaseId, collectionId, or documentIds array.");
    }

    log(`Starting non-blocking bulk delete for ${documentIds.length} documents...`);

    const BATCH_SIZE = 25;
    let successCount = 0;
    const failures = [];

    for (let i = 0; i < documentIds.length; i += BATCH_SIZE) {
      const chunk = documentIds.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        chunk.map(id => databases.deleteDocument(databaseId, collectionId, id))
      );

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successCount++;
        } else {
          const id = chunk[index];
          error(`Failed to delete ${id}: ${result.reason.message}`);
          failures.push({ id, message: result.reason.message });
        }
      });
    }

    return res.json({
      success: failures.length === 0,
      deletedCount: successCount,
      failedCount: failures.length,
      failures: failures
    }, 200);

  } catch (err) {
    error(`Bulk delete critical failure: ${err.message}`);
    return res.json({
      success: false,
      message: err.message
    }, 500);
  }
};