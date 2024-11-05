import { Pinecone } from '@pinecone-database/pinecone';
import { WorkOS, WarrantOp } from '@workos-inc/node';
import { OpenAIEmbeddings } from '@langchain/openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env.local') });

const requiredEnvVars = [
  'WORKOS_API_KEY',
  'PINECONE_API_KEY',
  'PINECONE_INDEX',
  'OPENAI_API_KEY'
];
// Check that all required environment variables are set, and throw an error if any are missing
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Set up the clients to WorkOS, Pinecone and OpenAI
const workos = new WorkOS(process.env.WORKOS_API_KEY);
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});
const embeddings = new OpenAIEmbeddings();

async function setupPineconeClient() {
  await pinecone.createIndex({
    name: process.env.PINECONE_INDEX,
    dimension: 1536,
    metric: 'cosine',
    spec: {
      serverless: {
        cloud: 'aws',
        region: 'us-east-1'
      }
    },
    suppressConflicts: true,
    waitUntilReady: true,
  });

  return pinecone.index(process.env.PINECONE_INDEX);
}

// Helper function to get display name from document ID
function getDocumentDisplayName(docId) {
  return docId.replace('doc_', '')  // Remove 'doc_' prefix
    .split('-')                     // Split on hyphens
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
    .join(' ');                     // Join with spaces
}

async function getAccessibleDocuments(userId) {
  try {
    console.log(`\n=== Checking document access for user: ${userId} ===`);
    
    const queryResponse = await workos.fga.query({
      q: `select document where user:${userId} is viewer`
    });

    console.log(`=== FGA Query Response ===`);
    console.log(`%`, queryResponse.data);

    // Extract document ID from each result object
    const accessibleDocs = queryResponse.data.map(result => 
      result.resourceId
    );
    
    if (accessibleDocs.length > 0) {
      const accessibleNames = accessibleDocs.map(getDocumentDisplayName);
      console.log(`✅ User has access to: ${accessibleNames.join(', ')}`);
    } else {
      console.log(`❌ User has no document access`);
    }

    return accessibleDocs;
  } catch (error) {
    console.error('Error querying document access:', error);
    return [];
  }
}

async function createBasicWarrants() {
  try {
    console.log("\n=== Creating Basic Warrants ===");

    // Give user1 owner access to Sherlock Holmes
    await workos.fga.writeWarrant({
      op: WarrantOp.Create,
      resource: {
        resourceType: 'document',
        resourceId: 'doc_sherlock-holmes',
      },
      relation: 'owner',
      subject: {
        resourceType: 'user',
        resourceId: 'user1',
      },
    });
    console.log(`👤 Granted user1 owner access to "Sherlock Holmes"`);

    // Give user2 viewer access to Federalist Papers
    await workos.fga.writeWarrant({
      op: WarrantOp.Create,
      resource: {
        resourceType: 'document',
        resourceId: 'doc_federalist-papers',
      },
      relation: 'viewer',
      subject: {
        resourceType: 'user',
        resourceId: 'user2',
      },
    });
    console.log(`👤 Granted user2 viewer access to "The Federalist Papers"`);

  } catch (error) {
    console.error('Error creating warrants:', error);
    throw error;
  }
}

// Modified searchPineconeWithAccess function
async function searchPineconeWithAccess(userId, searchQuery) {
  try {
    console.log(`\n=== 🔍 Searching for user ${userId} with query: "${searchQuery}" ===`);

    const accessibleDocs = await getAccessibleDocuments(userId);
    
    if (accessibleDocs.length === 0) {
      console.log('❌ User has no document access - skipping search');
      return [];
    }

    // Only proceed with search if we have accessible documents
    const accessibleNames = accessibleDocs.map(getDocumentDisplayName);
    console.log(`✅ User can search in: ${accessibleNames.join(', ')}`);
    
    const queryEmbedding = await embeddings.embedQuery(searchQuery);
    const index = await setupPineconeClient();

    const searchResponse = await index.query({
      vector: queryEmbedding,
      filter: {
        parentDocumentId: { $in: accessibleDocs }
      },
      topK: 5,
      includeMetadata: true
    });

    console.log('\n=== Search Results ===');
    searchResponse.matches.forEach((match, i) => {
      const docName = getDocumentDisplayName(match.metadata.parentDocumentId);
      console.log(`\n${i + 1}. From "${docName}":`);
      console.log(`   Score: ${match.score}`);
      console.log(`   Text: ${match.metadata.text}`);
    });

    return searchResponse.matches;
  } catch (error) {
    console.error('Error in search:', error);
    return [];
  }
}

// Add new function to share document access
async function shareDocumentAccess(ownerId, newUserId) {
  try {
    console.log(`\n=== 🤝 Sharing documents with user${newUserId} ===`);
    
    // First verify the owner has permission for both documents
    const checkResult = await workos.fga.check({
      checks: [{
        resource: {
          resourceType: 'document',
          resourceId: 'doc_sherlock-holmes',
        },
        relation: 'owner',
        subject: {
          resourceType: 'user',
          resourceId: ownerId,
        },
      }]
    });

    if (!checkResult.isAuthorized()) {
      console.log(`❌ User ${ownerId} is not owner of the documents - cannot share`);
      return false;
    }

    // Grant viewer access to both documents
    const documentsToShare = [
      'doc_sherlock-holmes',
      'doc_federalist-papers'
    ];

    for (const docId of documentsToShare) {
      await workos.fga.writeWarrant({
        op: WarrantOp.Create,
        resource: {
          resourceType: 'document',
          resourceId: docId,
        },
        relation: 'viewer',
        subject: {
          resourceType: 'user',
          resourceId: newUserId,
        },
      });
      console.log(`✅ Shared "${getDocumentDisplayName(docId)}" with user${newUserId}`);
    }
    
    return true;
  } catch (error) {
    console.error('Error sharing document access:', error);
    return false;
  }
}

// Add function to clean up warrants
async function cleanupWarrants() {
  try {
    console.log("\n=== 🧹 Cleaning up Warrants ===");
    
    // Delete all warrants created during demo
    const warrants = [
      // user1 owner of Sherlock Holmes
      {
        resource: { resourceType: 'document', resourceId: 'doc_sherlock-holmes' },
        relation: 'owner',
        subject: { resourceType: 'user', resourceId: 'user1' },
      },
      // user2 viewer of Federalist Papers
      {
        resource: { resourceType: 'document', resourceId: 'doc_federalist-papers' },
        relation: 'viewer',
        subject: { resourceType: 'user', resourceId: 'user2' },
      },
      // user3 viewer of Sherlock Holmes (created during share)
      {
        resource: { resourceType: 'document', resourceId: 'doc_sherlock-holmes' },
        relation: 'viewer',
        subject: { resourceType: 'user', resourceId: 'user3' },
      },
    ];

    for (const warrant of warrants) {
      await workos.fga.writeWarrant({
        op: WarrantOp.Delete,
        ...warrant,
      });
    }
    
    console.log("✅ All warrants cleaned up");
  } catch (error) {
    console.error('Error cleaning up warrants:', error);
  }
}

// Add sleep helper function
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Modified runDemo function
async function runDemo() {
  try {
    await createBasicWarrants();
    
    // Wait for initial warrants to propagate
    console.log('\n⏳ Waiting for initial warrants to propagate...');
    await sleep(6000);

    const searchQuery = "What are the principles of justice and liberty?";
    
    console.log('\n=== 🧪 Testing Access Controls and Search ===');
    
    // Initial search attempts
    console.log('\n--- Initial Access State ---');
    await searchPineconeWithAccess('user1', searchQuery);
    await searchPineconeWithAccess('user2', searchQuery);
    await searchPineconeWithAccess('user3', searchQuery);  // This should fail

    // Simulate sharing
    console.log('\n--- Sharing Document ---');
    const shareSuccess = await shareDocumentAccess('user1', 'user4');
    
    if (shareSuccess) {
      // Wait for FGA consistency
      console.log('\n⏳ Waiting to propagate changes...');
      await sleep(4000); 
      
      // Test access after sharing
      console.log('\n--- Access After Sharing ---');
      await searchPineconeWithAccess('user4', searchQuery);  // This should now succeed
    }
    
    // Clean up at the end
    await cleanupWarrants();
    
  } catch (error) {
    console.error('Demo failed:', error);
  }
}

runDemo();
