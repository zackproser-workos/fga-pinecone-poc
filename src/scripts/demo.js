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
      q: `select document where user:${userId} is viewer`,
    });

    console.log(`%`, queryResponse.data);

    // Extract resource_id from each result object in the list.data array
    const accessibleDocs = queryResponse.data.map(result => result.resourceId);
    
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
    throw error;
  }
}

// Modified runDemo function
async function runDemo() {
  try {
    await createBasicWarrants();

    const searchQuery = "What are the principles of justice and liberty?";
    
    console.log('\n=== 🧪 Testing Access Controls and Search ===');
    await searchPineconeWithAccess('user1', searchQuery);
    await searchPineconeWithAccess('user2', searchQuery);
    await searchPineconeWithAccess('user3', searchQuery);
    
  } catch (error) {
    console.error('Demo failed:', error);
  }
}

runDemo();
