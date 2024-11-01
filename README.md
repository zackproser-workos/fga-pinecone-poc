# FGA Document Access Control POC

## Overview
This proof-of-concept demonstrates fine-grained access control for document management using WorkOS FGA (Fine-Grained Authorization) integrated with Pinecone vector database. The system allows:

- Document ownership and sharing permissions
- PDF processing and chunking for vector storage
- Access-controlled vector search based on user permissions
- Demonstration of permission inheritance and access control checks

## Prerequisites
- Node.js v20.5.0 or newer
- WorkOS API Key
- Pinecone API Key and Environment
- zsh (for running scripts)

## Usage

1. Copy environment variables and fill in secrets:
```bash
cp .env.example .env.local
# Edit .env.local with your API keys
```

2. Set up the WorkOS authorization model:
```bash
export WORKOS_API_KEY=your_key_here
./src/scripts/defineResourceTypes.sh
```

3. Process documents and create vector embeddings:
```bash
node src/scripts/setupPinecone.js
```

4. Run the demo to test access controls and search:
```bash
node src/scripts/demo.js
```

<details>
<summary>Click to see expected demo output</summary>

```
=== Creating Basic Warrants ===
👤 Granted user1 owner access to "Sherlock Holmes" (doc_sherlock-holmes)
👤 Granted user2 viewer access to "The Federalist Papers" (doc_federalist-papers)

=== 🧪 Testing Access Controls and Search ===

=== 🔍 Searching for user user1 with query: "What are the principles of justice and liberty?" ===

=== Checking document access for user: user1 ===
✅ User user1 has access to "Sherlock Holmes" (doc_sherlock-holmes)
❌ User user1 does NOT have access to "The Federalist Papers" (doc_federalist-papers)
❌ User user1 does NOT have access to "Universal Declaration of Human Rights" (doc_universal-declaration)
✅ User can search in: Sherlock Holmes

=== Search Results ===

1. From "Sherlock Holmes":
   Score: 0.742549837
   Text: T h e   A d v e n t u r e s
o f   S h e r l o c k
H o l m e s
by Arthur Conan Doyle
Contents
I.A Scandal in Bohemia
II.The Red-Headed League

2. From "Sherlock Holmes":
   Score: 0.741582453
   Text: and seriously compromise one of the reigning families of Europe. To
speak plainly, the matter implicates the great House of Ormstein,
hereditary kings of Bohemia."
"I was also aware of that," murmured Holmes, settling himself
down in his armchair and closing his eyes...

[Additional results from Sherlock Holmes...]

=== 🔍 Searching for user user2 with query: "What are the principles of justice and liberty?" ===

=== Checking document access for user: user2 ===
❌ User user2 does NOT have access to "Sherlock Holmes" (doc_sherlock-holmes)
✅ User user2 has access to "The Federalist Papers" (doc_federalist-papers)
❌ User user2 does NOT have access to "Universal Declaration of Human Rights" (doc_universal-declaration)
✅ User can search in: The Federalist Papers

=== Search Results ===

1. From "The Federalist Papers":
   Score: 0.821266532
   Text: of love, and that the noble enthusiasm of liberty is apt to be infected
with a spirit of narrow and illiberal distrust. On the other hand, it will
be equally forgotten that the vigor of government is essential to the
security of liberty; that, in the contemplation of a sound and well-
informed judgment, their interest can never be separated...

2. From "The Federalist Papers":
   Score: 0.798069715
   Text: denominations of men among us. To all general purposes we have
uniformly been one people each individual citizen everywhere
enjoying the same national rights, privileges, and protection...

[Additional results from The Federalist Papers...]

=== 🔍 Searching for user user3 with query: "What are the principles of justice and liberty?" ===

=== Checking document access for user: user3 ===
❌ User user3 does NOT have access to "Sherlock Holmes" (doc_sherlock-holmes)
❌ User user3 does NOT have access to "The Federalist Papers" (doc_federalist-papers)
❌ User user3 does NOT have access to "Universal Declaration of Human Rights" (doc_universal-declaration)
❌ User has no document access - skipping search
```
</details>

## How It Works

### Setup Phase
1. `defineResourceTypes.sh` creates two resource types in WorkOS FGA:
   - `document`: has "owner" and "viewer" relations (owners automatically get viewer access)
   - `user`: represents system users

2. `setupPinecone.js` prepares the document data:
   - Processes PDF documents into text chunks
   - Creates vector embeddings for each chunk
   - Stores vectors in Pinecone with document IDs as metadata

```mermaid
graph TD
    A[defineResourceTypes.sh] -->|Creates| B[WorkOS Resource Types]
    B -->|Defines| C[document & user types]
    C -->|Defines Relations| D[owner & viewer]
    
    E[setupPinecone.js] -->|Processes| F[PDF Documents]
    F -->|Creates| G[Vector Embeddings]
    G -->|Stores in| H[Pinecone Index]

    style A fill:#e1f5fe
    style E fill:#e1f5fe
    style H fill:#fff3e0
    style B fill:#fff3e0
```

### Runtime Phase
1. `demo.js` sets up access permissions:
   - Creates warrants in WorkOS FGA (e.g., "user1 owns doc_sherlock-holmes")
   - These warrants determine who can access which documents

2. When a user makes a search query:
   - System checks WorkOS FGA to get list of documents the user can access
   - Uses these document IDs to filter Pinecone search results
   - Returns only results from documents the user has permission to view

```mermaid
graph TD
    A[demo.js] -->|Creates| B[WorkOS Warrants]
    B -->|Grants Access| C[user1 owns Sherlock]
    B -->|Grants Access| D[user2 views Federalist]
    
    E[User Query] -->|Triggers| F[Access Check]
    F -->|Calls| G[WorkOS FGA Check]
    G -->|Returns| H[Accessible Doc IDs]
    
    H -->|Filters| I[Pinecone Query]
    I -->|Returns| J[Filtered Results]

    style A fill:#e1f5fe
    style B fill:#fff3e0
    style G fill:#fff3e0
    style I fill:#fff3e0
```

## Tech Stack
- WorkOS FGA for authorization
- Pinecone for vector storage
- LangChain for PDF processing
- Node.js/TypeScript

## Project Structure
```
.
├── data/                   # Sample PDF documents
├── src/
│   ├── scripts/
│   │   ├── defineResourceTypes.sh  # Creates WorkOS resource types
│   │   ├── setupPinecone.js        # Processes docs and creates vectors
│   │   └── demo.js                 # Demonstrates access control
│   └── utils/              # Helper functions
├── .env.example           # Example environment variables
└── README.md
```