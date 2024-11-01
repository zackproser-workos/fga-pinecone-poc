import { Pinecone } from '@pinecone-database/pinecone';
import { WorkOS, WarrantOp, CheckOp } from '@workos-inc/node';
import { OpenAIEmbeddings } from '@langchain/openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env.local') });

const requiredEnvVars = [
  'WORKOS_API_KEY',
  'PINECONE_API_KEY',
  'PINECONE_INDEX',
  'OPENAI_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

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

// Helper function to create stable document IDs
function createStableDocumentId(filePath) {
  const filename = basename(filePath);
  return `doc_${filename.replace('.pdf', '')}`;
}

const TEST_DOCUMENTS = {
  'sherlock-holmes': {
    displayName: 'Sherlock Holmes',
    path: join(__dirname, '../../data/sherlock-holmes.pdf')
  },
  'federalist-papers': {
    displayName: 'The Federalist Papers',
    path: join(__dirname, '../../data/federalist-papers.pdf')
  },
  'universal-declaration': {
    displayName: 'Universal Declaration of Human Rights',
    path: join(__dirname, '../../data/universal-declaration.pdf')
  }
};

// Helper function to get display name from document ID
function getDocumentDisplayName(docId) {
  return Object.values(TEST_DOCUMENTS).find(doc => 
    createStableDocumentId(doc.path) === docId
  )?.displayName || docId;
}

// Modified getAccessibleDocuments function
async function getAccessibleDocuments(userId) {
  try {
    console.log(`\n=== Checking document access for user: ${userId} ===`);
    const documentIds = Object.values(TEST_DOCUMENTS).map(doc => 
      createStableDocumentId(doc.path)
    );
    
    const accessibleDocs = [];
    
    for (const docId of documentIds) {
      const displayName = getDocumentDisplayName(docId);
      
      const checkResult = await workos.fga.check({
        op: CheckOp.AnyOf,
        checks: [
          {
            resource: {
              resourceType: 'document',
              resourceId: docId,
            },
            relation: 'viewer',
            subject: {
              resourceType: 'user',
              resourceId: userId,
            },
          },
          {
            resource: {
              resourceType: 'document',
              resourceId: docId,
            },
            relation: 'owner',
            subject: {
              resourceType: 'user',
              resourceId: userId,
            },
          }
        ],
      });

      if (checkResult.isAuthorized()) {
        console.log(`✅ User ${userId} has access to "${displayName}" (${docId})`);
        accessibleDocs.push(docId);
      } else {
        console.log(`❌ User ${userId} does NOT have access to "${displayName}" (${docId})`);
      }
    }

    return accessibleDocs;
  } catch (error) {
    console.error('Error checking document access:', error);
    return [];
  }
}

// Modified createBasicWarrants function
async function createBasicWarrants() {
  try {
    console.log("\n=== Creating Basic Warrants ===");

    // Give user1 owner access to Sherlock Holmes
    const sherlockId = createStableDocumentId(TEST_DOCUMENTS['sherlock-holmes'].path);
    await workos.fga.writeWarrant({
      op: WarrantOp.Create,
      resource: {
        resourceType: 'document',
        resourceId: sherlockId,
      },
      relation: 'owner',
      subject: {
        resourceType: 'user',
        resourceId: 'user1',
      },
    });
    console.log(`👤 Granted user1 owner access to "Sherlock Holmes" (${sherlockId})`);

    // Give user2 viewer access to Federalist Papers
    const federalistId = createStableDocumentId(TEST_DOCUMENTS['federalist-papers'].path);
    await workos.fga.writeWarrant({
      op: WarrantOp.Create,
      resource: {
        resourceType: 'document',
        resourceId: federalistId,
      },
      relation: 'viewer',
      subject: {
        resourceType: 'user',
        resourceId: 'user2',
      },
    });
    console.log(`👤 Granted user2 viewer access to "The Federalist Papers" (${federalistId})`);

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
