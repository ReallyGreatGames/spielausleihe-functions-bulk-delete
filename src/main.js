import { Client, Databases } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);

  let body = req.bodyJson || {};
  const { databaseId, collectionId, documentIds } = body;

  const snapshots = []; // Store original data for rollback
  const deletedIds = []; // Track what we successfully deleted

  try {
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      throw new Error("No documentIds provided.");
    }

    log(`Backing up ${documentIds.length} documents before deletion...`);

    // 1. Snapshot phase: Get the data so we can restore it if needed
    for (const id of documentIds) {
      try {
        const doc = await databases.getDocument(databaseId, collectionId, id);
        // Remove Appwrite system fields ($id, $permissions, etc.) before re-insertion
        const { $id, $createdAt, $updatedAt, $databaseId, $collectionId, $permissions, ...data } = doc;
        snapshots.push({ id: $id, data, permissions: $permissions });
      } catch (e) {
        throw new Error(`Snapshot failed for ${id}: ${e.message}`);
      }
    }

    log("Snapshot complete. Proceeding with deletion...");

    // 2. Deletion phase
    for (const item of snapshots) {
      try {
        await databases.deleteDocument(databaseId, collectionId, item.id);
        deletedIds.push(item.id);
      } catch (e) {
        throw new Error(`Deletion failed for ${item.id}: ${e.message}`);
      }
    }

    return res.json({ success: true, deletedCount: deletedIds.length }, 200);

  } catch (err) {
    error(`Transaction failed: ${err.message}. Initializing rollback...`);

    // 3. Rollback phase: Restore the deleted documents
    const restored = [];
    for (const item of snapshots) {
      // Only restore documents that were actually deleted
      if (deletedIds.includes(item.id)) {
        try {
          await databases.createDocument(
            databaseId,
            collectionId,
            item.id,
            item.data,
            item.permissions
          );
          restored.push(item.id);
        } catch (reErr) {
          error(`CRITICAL: Failed to restore document ${item.id}: ${reErr.message}`);
        }
      }
    }

    return res.json({
      success: false,
      message: err.message,
      rolledBack: true,
      restoredCount: restored.length
    }, 500);
  }
};