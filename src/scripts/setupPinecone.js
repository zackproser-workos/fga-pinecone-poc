import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env.local') });

const TEST_DOCUMENTS = {
  'sherlock-holmes': {
    displayName: 'Sherlock Holmes',
    path: join(__dirname, '../../data/sherlock-holmes.pdf'),
    maxPages: 10
  },
  'federalist-papers': {
    displayName: 'The Federalist Papers',
    path: join(__dirname, '../../data/federalist-papers.pdf'),
    maxPages: 10
  },
  'universal-declaration': {
    displayName: 'Universal Declaration of Human Rights',
    path: join(__dirname, '../../data/universal-declaration.pdf'),
    maxPages: 10
  }
};

function createStableDocumentId(filePath) {
  const filename = basename(filePath);
  return `doc_${filename.replace('.pdf', '')}`;
}

async function setupPineconeClient() {
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });

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

async function processDocument(docInfo) {
  console.log(`\n📚 Processing "${docInfo.displayName}"...`);
  
  const loader = new PDFLoader(docInfo.path, {
    splitPages: true
  });

  const docs = await loader.load();
  console.log(`   📄 Loaded ${docs.length} pages`);

  // Limit to maxPages if specified
  const limitedDocs = docInfo.maxPages ? docs.slice(0, docInfo.maxPages) : docs;
  
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const chunks = await splitter.splitDocuments(limitedDocs);
  console.log(`   🔪 Split into ${chunks.length} chunks`);
  
  return chunks;
}

async function bootstrapDocuments() {
  try {
    console.log('=== 🚀 Starting Pinecone Setup ===');
    
    const index = await setupPineconeClient();
    const embeddings = new OpenAIEmbeddings();
    
    // Process each document
    for (const [key, docInfo] of Object.entries(TEST_DOCUMENTS)) {
      const chunks = await processDocument(docInfo);
      const docId = createStableDocumentId(docInfo.path);
      
      console.log(`\n📥 Uploading chunks for "${docInfo.displayName}" (${docId})`);
      
      // Process in batches to avoid rate limits
      const batchSize = 100;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        
        const vectors = await Promise.all(
          batch.map(async (chunk, j) => {
            const embedding = await embeddings.embedQuery(chunk.pageContent);
            return {
              id: `chunk_${docId}_${chunk.metadata.pageNumber}_${j}`,
              values: embedding,
              metadata: {
                text: chunk.pageContent,
                source: docInfo.path,
                page: chunk.metadata.pageNumber,
                parentDocumentId: docId,
                documentName: docInfo.displayName
              },
            };
          })
        );

        await index.upsert(vectors);
        console.log(`   ✅ Uploaded batch ${i/batchSize + 1} (${vectors.length} chunks)`);
      }
    }

    console.log('\n=== 🎉 Setup Complete! ===');
  } catch (error) {
    console.error('❌ Setup failed:', error);
    throw error;
  }
}

// Run the bootstrap process
bootstrapDocuments();