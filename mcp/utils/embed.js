// utils/embed.js - Updated Embedding Utils for Ollama
const axios = require('axios');

const EMBEDDING_CONFIG = {
  provider: process.env.EMBEDDING_PROVIDER || 'ollama',
  
  ollama: {
    baseUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS) || 768
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'text-embedding-3-small',
    apiUrl: 'https://api.openai.com/v1/embeddings'
  }
};

/**
 * Generate embeddings for text chunks using Ollama's nomic-embed-text model
 * @param {string|string[]} input - Text or array of text chunks to embed
 * @returns {Promise<number[]|number[][]>} Embedding vector(s)
 */
async function generateEmbeddings(input) {
  const isArray = Array.isArray(input);
  const chunks = isArray ? input : [input];
  
  console.log(`Generating embeddings for ${chunks.length} chunks using ${EMBEDDING_CONFIG.provider} provider`);
  
  try {
    switch (EMBEDDING_CONFIG.provider) {
      case 'ollama':
        const embeddings = await generateOllamaEmbeddings(chunks);
        return isArray ? embeddings : embeddings[0];
      case 'openai':
        const openaiEmbeddings = await generateOpenAIEmbeddings(chunks);
        return isArray ? openaiEmbeddings : openaiEmbeddings[0];
      default:
        const mockEmbeddings = generateMockEmbeddings(chunks);
        return isArray ? mockEmbeddings : mockEmbeddings[0];
    }
  } catch (error) {
    console.error('Error generating embeddings:', error.message);
    console.warn('Falling back to mock embeddings');
    const mockEmbeddings = generateMockEmbeddings(chunks);
    return isArray ? mockEmbeddings : mockEmbeddings[0];
  }
}

/**
 * Generate embeddings using Ollama's nomic-embed-text model
 */
async function generateOllamaEmbeddings(chunks) {
  const { baseUrl, model } = EMBEDDING_CONFIG.ollama;
  
  console.log(`Using Ollama model: ${model}`);
  
  try {
    // Check if model is available
    await checkOllamaModel(model);
    
    const embeddings = [];
    
    // Process chunks individually to avoid context limits
    for (const chunk of chunks) {
      const response = await axios.post(`${baseUrl}/api/embeddings`, {
        model: model,
        prompt: chunk
      }, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data && response.data.embedding) {
        embeddings.push(response.data.embedding);
      } else {
        throw new Error('Invalid response format from Ollama embeddings API');
      }
      
      // Small delay between requests to avoid overwhelming Ollama
      if (chunks.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return embeddings;
    
  } catch (error) {
    console.error('Ollama embedding error:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Ollama service is not running at ${baseUrl}`);
    }
    
    if (error.response?.status === 404) {
      throw new Error(`Model "${model}" not found. Please run: ollama pull ${model}`);
    }
    
    throw error;
  }
}

/**
 * Check if Ollama model is available
 */
async function checkOllamaModel(modelName) {
  const { baseUrl } = EMBEDDING_CONFIG.ollama;
  
  try {
    const response = await axios.get(`${baseUrl}/api/tags`, {
      timeout: 5000
    });
    
    const availableModels = response.data.models || [];
    const modelExists = availableModels.some(model => 
      model.name === modelName || model.name.startsWith(modelName)
    );
    
    if (!modelExists) {
      const availableNames = availableModels.map(m => m.name).join(', ');
      throw new Error(
        `Model "${modelName}" not found. Available models: ${availableNames}. ` +
        `Please run: ollama pull ${modelName}`
      );
    }
    
    console.log(`✅ Ollama model "${modelName}" is available`);
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Ollama service is not running at ${baseUrl}`);
    }
    throw error;
  }
}

/**
 * Generate embeddings using OpenAI's API (fallback)
 */
async function generateOpenAIEmbeddings(chunks) {
  if (!EMBEDDING_CONFIG.openai.apiKey) {
    throw new Error('OpenAI API key not found');
  }
  
  const response = await axios.post(
    EMBEDDING_CONFIG.openai.apiUrl,
    {
      input: chunks,
      model: EMBEDDING_CONFIG.openai.model
    },
    {
      headers: {
        'Authorization': `Bearer ${EMBEDDING_CONFIG.openai.apiKey}`,
        'Content-Type': 'application/json'
      }
    }
  );
  
  return response.data.data.map(item => item.embedding);
}

/**
 * Generate mock embeddings for development/testing
 */
function generateMockEmbeddings(chunks) {
  const dimensions = EMBEDDING_CONFIG.ollama.dimensions;
  
  return chunks.map(chunk => {
    const vector = new Array(dimensions).fill(0);
    
    // Generate deterministic values based on text content
    let hash = 0;
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    // Fill vector with normalized values
    for (let i = 0; i < vector.length; i++) {
      const seed = hash + i * 1234567;
      vector[i] = (Math.sin(seed) + Math.cos(seed * 0.7)) / 2;
    }

    // Normalize vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / (magnitude || 1));
  });
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
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = { 
  generateEmbeddings, 
  cosineSimilarity,
  checkOllamaModel
};