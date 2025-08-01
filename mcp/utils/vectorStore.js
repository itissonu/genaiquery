// utils/vectorStore.js - Vector Store Implementation with ChromaDB
const { ChromaClient } = require('chromadb');
const { generateEmbeddings } = require('./embed');

const COLLECTION_NAME = 'schema_embeddings';
const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';

let client;
let collection;

/**
 * Initialize ChromaDB client and collection
 */
const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

async function initializeVectorStore() {
    try {
        console.log(`🔌 Connecting to ChromaDB at ${CHROMA_URL}...`);

        const client = new ChromaClient({ host: 'localhost', port: 8000, ssl: false });


        // 🧠 Define custom embedding function using Ollama
        const embeddingFunction = {
            embedDocuments: async (texts) => {
                const response = await axios.post(`${OLLAMA_URL}/api/embeddings`, {
                    model: OLLAMA_EMBED_MODEL,
                    prompt: texts
                });
                return response.data.embeddings;
            },
            embedQuery: async (text) => {
                const response = await axios.post(`${OLLAMA_URL}/api/embeddings`, {
                    model: OLLAMA_EMBED_MODEL,
                    prompt: [text]
                });
                return response.data.embeddings[0];
            }
        };

        let collection;
        try {
            collection = await client.getCollection({
                name: COLLECTION_NAME
                // embeddingFunction
            });
            console.log(`📚 Using existing collection: ${COLLECTION_NAME}`);
        } catch (error) {
            collection = await client.createCollection({
                name: COLLECTION_NAME,
               // embeddingFunction,
                metadata: {
                    description: 'Database schema embeddings for RAG',
                    created_at: new Date().toISOString()
                }
            });
            console.log(`📚 Created new collection: ${COLLECTION_NAME}`);
        }

        global.vectorStore = { client, collection };
        return { client, collection };
    } catch (error) {
        console.error('❌ Failed to initialize vector store:', error);
        console.log('🔄 Falling back to in-memory vector store...');
        return initializeInMemoryStore(); // You must have defined this elsewhere
    }
}

/**
 * Fallback in-memory vector store implementation
 */
function initializeInMemoryStore() {
    const inMemoryStore = {
        documents: new Map(), // projectId -> documents[]
        isInMemory: true
    };

    global.vectorStore = inMemoryStore;

    console.log('✅ In-memory vector store initialized');
    return inMemoryStore;
}

/**
 * Store schema embeddings in the vector database
 * @param {object} vectorStore - Vector store instance
 * @param {string} projectId - Project identifier
 * @param {string[]} chunks - Text chunks to embed and store
 * @param {object} metadata - Additional metadata about the schema
 */
async function storeSchemaEmbeddings(vectorStore, projectId, chunks, metadata = {}) {
    console.log(`💾 Storing ${chunks.length} schema embeddings for project: ${projectId}`);

    try {
        if (vectorStore.isInMemory) {
            await storeInMemoryEmbeddings(vectorStore, projectId, chunks, metadata);
        } else {
            await storeChromaEmbeddings(vectorStore, projectId, chunks, metadata);
        }

        console.log(`✅ Successfully stored embeddings for project: ${projectId}`);

    } catch (error) {
        console.error(`❌ Failed to store embeddings for project ${projectId}:`, error);
        throw error;
    }
}

/**
 * Store embeddings in ChromaDB
 */
async function storeChromaEmbeddings(vectorStore, projectId, chunks, metadata) {
    const { collection } = vectorStore;

    // Generate embeddings for all chunks
    const embeddings = [];
    const documents = [];
    const metadatas = [];
    const ids = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await generateEmbeddings(chunk);
        // console.log({ "embeddingat vectorstore": embedding })
        embeddings.push(embedding);
        documents.push(chunk);
        metadatas.push({
            projectId,
            chunkIndex: i,
            timestamp: new Date().toISOString(),
            ...metadata
        });
        ids.push(`${projectId}_${i}_${Date.now()}`);
    }
    //console.log(embeddings)
    // Add to ChromaDB collection



    await collection.add({
        ids,
        embeddings,
        documents,
        metadatas
    });
    const count = await collection.count();
   // console.log("🧮 Total vectors stored in collection:", count);

// const result = await collection.get({
//   include: ['embeddings', 'documents', 'metadatas', 'uris'], // ✅ only these allowed
//   where: { projectId }
// });



   // console.log("📦 Confirmed in collection:", result.embeddings);

}

/**
 * Store embeddings in memory (fallback)
 */
async function storeInMemoryEmbeddings(vectorStore, projectId, chunks, metadata) {
    if (!vectorStore.documents.has(projectId)) {
        vectorStore.documents.set(projectId, []);
    }

    const projectDocs = vectorStore.documents.get(projectId);

    // Clear existing documents for this project
    projectDocs.length = 0;

    // Generate and store embeddings
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await generateEmbeddings(chunk);
        console.log({ "embeddingat vectorstore": embedding })
        const timestamp = Date.now();

        projectDocs.push({
            id: `${projectId}_${i}_${timestamp}`,
            text: chunk,
            embedding: embedding,
            metadata: {
                projectId,
                chunkIndex: i,
                timestamp: new Date().toISOString(),
                ...metadata
            }
        });
    }
}

/**
 * Search for similar chunks using cosine similarity
 * @param {object} vectorStore - Vector store instance
 * @param {string} projectId - Project to search within
 * @param {number[]} queryEmbedding - Embedding of the search query
 * @param {number} topK - Number of top results to return
 * @returns {Array} Array of similar chunks with similarity scores
 */
async function searchSimilarChunks(vectorStore, projectId, queryEmbedding, topK = 5) {
    console.log(`🔍 Searching for top ${topK} similar chunks in project: ${projectId}`);

    try {
        let results;

        if (vectorStore.isInMemory) {
            results = await searchInMemoryChunks(vectorStore, projectId, queryEmbedding, topK);
        } else {
            results = await searchChromaChunks(vectorStore, projectId, queryEmbedding, topK);
        }

        console.log(`📊 Found ${results.length} similar chunks`);
        return results;

    } catch (error) {
        console.error(`❌ Search failed for project ${projectId}:`, error);
        return [];
    }
}

/**
 * Search ChromaDB for similar chunks
 */
async function searchChromaChunks(vectorStore, projectId, queryEmbedding, topK) {
    const { collection } = vectorStore;

    const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
        where: { projectId: projectId }
    });

    // Format results
    const formattedResults = [];

    if (results.documents && results.documents[0]) {
        for (let i = 0; i < results.documents[0].length; i++) {
            formattedResults.push({
                text: results.documents[0][i],
                similarity: 1 - (results.distances?.[0]?.[i] || 0), // Convert distance to similarity
                metadata: results.metadatas?.[0]?.[i] || {},
                id: results.ids?.[0]?.[i]
            });
        }
    }

    return formattedResults;
}

/**
 * Search in-memory store for similar chunks
 */
async function searchInMemoryChunks(vectorStore, projectId, queryEmbedding, topK) {
    const projectDocs = vectorStore.documents.get(projectId) || [];

    if (projectDocs.length === 0) {
        return [];
    }

    // Calculate cosine similarity for each document
    const similarities = projectDocs.map(doc => ({
        ...doc,
        similarity: cosineSimilarity(queryEmbedding, doc.embedding)
    }));

    // Sort by similarity and return top k
    return similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK)
        .map(doc => ({
            text: doc.text,
            similarity: doc.similarity,
            metadata: doc.metadata,
            id: doc.id
        }));
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
        throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dotProduct / (normA * normB);
}

/**
 * Get project statistics
 */
async function getProjectStats(vectorStore, projectId) {
    try {
        if (vectorStore.isInMemory) {
            const projectDocs = vectorStore.documents.get(projectId) || [];
            return {
                projectId,
                documentCount: projectDocs.length,
                lastUpdated: projectDocs.length > 0 ?
                    Math.max(...projectDocs.map(doc => new Date(doc.metadata.timestamp).getTime())) : null
            };
        } else {
            // For ChromaDB, we'd need to query with filters
            const results = await vectorStore.collection.get({
                where: { projectId: projectId }
            });

            return {
                projectId,
                documentCount: results.ids?.length || 0,
                lastUpdated: results.metadatas?.length > 0 ?
                    Math.max(...results.metadatas.map(meta => new Date(meta.timestamp).getTime())) : null
            };
        }
    } catch (error) {
        console.error(`❌ Failed to get stats for project ${projectId}:`, error);
        return {
            projectId,
            documentCount: 0,
            lastUpdated: null,
            error: error.message
        };
    }
}

/**
 * Delete all embeddings for a project
 */
async function deleteProjectEmbeddings(vectorStore, projectId) {
    console.log(`🗑️ Deleting embeddings for project: ${projectId}`);

    try {
        if (vectorStore.isInMemory) {
            vectorStore.documents.delete(projectId);
        } else {
            // For ChromaDB, delete by project ID filter
            await vectorStore.collection.delete({
                where: { projectId: projectId }
            });
        }

        console.log(`✅ Successfully deleted embeddings for project: ${projectId}`);

    } catch (error) {
        console.error(`❌ Failed to delete embeddings for project ${projectId}:`, error);
        throw error;
    }
}

/**
 * List all projects with embeddings
 */
async function listProjects(vectorStore) {
    try {
        if (vectorStore.isInMemory) {
            const projects = Array.from(vectorStore.documents.keys());
            return projects.map(projectId => ({
                projectId,
                documentCount: vectorStore.documents.get(projectId).length
            }));
        } else {
            // For ChromaDB, we'd need to get all unique project IDs
            const results = await vectorStore.collection.get();
            const projectCounts = {};

            if (results.metadatas) {
                results.metadatas.forEach(metadata => {
                    const projectId = metadata.projectId;
                    projectCounts[projectId] = (projectCounts[projectId] || 0) + 1;
                });
            }

            return Object.entries(projectCounts).map(([projectId, count]) => ({
                projectId,
                documentCount: count
            }));
        }
    } catch (error) {
        console.error('❌ Failed to list projects:', error);
        return [];
    }
}

/**
 * Get vector store instance (for external access)
 */
function getVectorStore() {
    return global.vectorStore;
}

/**
 * Health check for vector store
 */
async function healthCheck() {
    try {
        if (!global.vectorStore) {
            return { status: 'unhealthy', message: 'Vector store not initialized' };
        }

        if (global.vectorStore.isInMemory) {
            return {
                status: 'healthy',
                type: 'in-memory',
                projectCount: global.vectorStore.documents.size
            };
        } else {
            // Test ChromaDB connection
            await global.vectorStore.client.heartbeat();
            const count = await global.vectorStore.collection.count();

            return {
                status: 'healthy',
                type: 'chromadb',
                url: CHROMA_URL,
                documentCount: count
            };
        }
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message
        };
    }
}

module.exports = {
    initializeVectorStore,
    storeSchemaEmbeddings,
    searchSimilarChunks,
    getProjectStats,
    deleteProjectEmbeddings,
    listProjects,
    getVectorStore,
    healthCheck
};