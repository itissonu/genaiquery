// tools/chatTool.js - Updated Schema-Aware Chat Tool with History
const { generateEmbeddings } = require('../utils/embed');
const { searchSimilarChunks } = require('../utils/vectorStore');
const axios = require('axios');

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b-instruct-q4_K_M';
const MAX_CONTEXT_CHUNKS = parseInt(process.env.MAX_CONTEXT_CHUNKS) || 5;
const MAX_CONVERSATION_HISTORY = parseInt(process.env.MAX_CONVERSATION_HISTORY) || 5;

/**
 * Schema-aware chat tool using RAG with conversation history
 * @param {string} input - User's chat input/question
 * @param {string} projectId - Project identifier for schema context
 * @param {string} userId - User identifier
 * @param {function} streamFn - Function to stream response chunks to client
 * @param {Array} conversationHistory - Recent conversation history
 * @returns {Array} Context chunks used for response generation
 */
async function chatTool(input, projectId, userId, streamFn, conversationHistory = []) {
    console.log(`💬 Processing chat request for project: ${projectId}`);

    let contextUsed = [];

    try {
        // Step 1: Retrieve relevant schema context using RAG
        const context = await retrieveSchemaContext(input, projectId);
        contextUsed = context.chunks;

        // Step 2: Construct context-aware prompt with history
        const prompt = buildContextAwarePrompt(input, context, projectId, conversationHistory);


        console.log({"the prompt we build is":prompt})
        // Step 3: Send to LLM and stream response
        await generateStreamingResponse(prompt, streamFn);

        return contextUsed;

    } catch (error) {
        console.error('❌ Chat tool error:', error);
        throw error;
    }
}

/**
 * Retrieve relevant schema chunks using vector similarity search
 */
function splitIntoChunks(text, chunkSize = 500, overlap = 50) {
    const chunks = [];
    let start = 0;

    while (start < text.length) {
        let end = start + chunkSize;

        if (end < text.length) {
            const lastSpace = text.lastIndexOf(' ', end);
            if (lastSpace > start + chunkSize * 0.7) {
                end = lastSpace;
            }
        }

        const chunk = text.slice(start, end).trim();
        if (chunk.length > 0) {
            chunks.push(chunk);
        }

        start = end - overlap;
        if (start >= text.length) break;
    }

    return chunks;
}

async function retrieveSchemaContext(query, projectId) {
    try {
        console.log(`🔍 Searching for relevant schema context...`);

        // Generate embedding for the user's question
        const queryEmbedding = await generateEmbeddings(query);

        // Search for similar chunks in the project's schema
        const relevantChunks = await searchSimilarChunks(
            global.vectorStore || require('../utils/vectorStore').getVectorStore(),
            projectId,
            queryEmbedding,
            MAX_CONTEXT_CHUNKS
        );

        console.log(`📊 Found ${relevantChunks.length} relevant schema chunks`);

        return {
            chunks: relevantChunks,
            hasContext: relevantChunks.length > 0
        };

    } catch (error) {
        console.warn('⚠️ Failed to retrieve schema context:', error.message);
        return { chunks: [], hasContext: false };
    }
}

/**
 * Build a context-aware prompt with schema information and conversation history
 */
function buildContextAwarePrompt(userInput, context, projectId, conversationHistory) {
    let prompt = '';
    const isPrismaSchema = context.chunks.some(
        chunk => chunk.metadata?.fileType === '.prisma'
    );

    console.log({"isPrisma":isPrismaSchema})
    // System prompt
    prompt += `You are an AI assistant helping with database and schema-related questions for project "${projectId}". `;
    prompt += `You have access to database schema information and conversation history to provide accurate, context-aware responses.\n\n`;

    // Add conversation history if available
    if (conversationHistory && conversationHistory.length > 0) {
        prompt += `**Recent Conversation History:**\n`;
        conversationHistory.forEach((conv, index) => {
            prompt += `${index + 1}. User: ${conv.userMessage}\n`;
            prompt += `   Assistant: ${conv.assistantResponse.substring(0, 200)}${conv.assistantResponse.length > 200 ? '...' : ''}\n\n`;
        });
    }

    // Add schema context if available
    if (context.hasContext && context.chunks.length > 0) {
        prompt += `**Database Schema Context:**\n`;
        context.chunks.forEach((chunk, index) => {
            prompt += `Schema Chunk ${index + 1} (similarity: ${(chunk.similarity * 100).toFixed(1)}%):\n`;
            prompt += `${chunk.text}\n`;
            if (chunk.metadata && chunk.metadata.filename) {
                prompt += `(Source: ${chunk.metadata.filename})\n`;
            }
            prompt += `\n`;
        });
    }

    // Current user question
    prompt += `**Current User Question:**\n${userInput}\n\n`;

    // Instructions
    prompt += `**Instructions:**\n`;
    prompt += `- Use the schema context above to provide accurate answers\n`;
    prompt += `- Reference the conversation history when relevant to maintain context\n`;
    prompt += `- If the question relates to database structure, tables, or fields, reference the schema\n`;
    prompt += `- If you need to suggest SQL queries, base them on the actual schema structure\n`;


    if (isPrismaSchema) {
        prompt += `- Since the schema is in Prisma format, also include equivalent Prisma ORM code using Prisma Client JS\n`;
    }

    prompt += `- If the question cannot be answered with the provided schema, say so clearly\n`;
    prompt += `- Be concise but thorough in your explanation\n`;
    prompt += `- Maintain conversational flow by acknowledging previous interactions when relevant\n\n`;
    prompt += `**Response:**`;

    return prompt;
}

/**
 * Generate streaming response from LLM (Ollama)
 */
async function generateStreamingResponse(prompt, streamFn) {
    try {
        console.log(`🤖 Generating response using ${DEFAULT_MODEL}...`);

        await checkOllamaHealth();

        const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
            model: DEFAULT_MODEL,
            prompt: prompt,
            stream: true,
            options: {
                temperature: 0.7,
                top_p: 0.9,
                max_tokens: 2000,
                stop: ["User:", "**User", "**Current User"]
            }
        }, {
            responseType: 'stream',
            timeout: 60000
        });

        let buffer = '';

        response.data.on('data', (chunk) => {
            buffer += chunk.toString();

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const parsed = JSON.parse(line);

                        if (parsed.response) {
                            streamFn({
                                type: 'content',
                                content: parsed.response,
                                done: parsed.done || false
                            });
                        }

                        if (parsed.done) {
                            console.log('✅ LLM response generation completed');
                            return;
                        }

                    } catch (parseError) {
                        console.warn('⚠️ Failed to parse JSON chunk:', line);
                    }
                }
            }
        });

        response.data.on('end', () => {
            console.log('✅ Response stream ended');
        });

        response.data.on('error', (error) => {
            console.error('❌ Stream error:', error);
            throw error;
        });

        await new Promise((resolve, reject) => {
            response.data.on('end', resolve);
            response.data.on('error', reject);
        });

    } catch (error) {
        console.error('❌ LLM generation error:', error.message);

        if (process.env.OPENAI_API_KEY) {
            console.log('🔄 Falling back to OpenAI...');
            await generateOpenAIResponse(prompt, streamFn);
        } else {
            streamFn({
                type: 'error',
                error: 'LLM service unavailable',
                message: `Failed to connect to Ollama at ${OLLAMA_BASE_URL}. Make sure Ollama is running and the model "${DEFAULT_MODEL}" is available.`,
                suggestion: `Try running: ollama pull ${DEFAULT_MODEL}`
            });
        }
    }
}

/**
 * Fallback to OpenAI API if Ollama is unavailable
 */
async function generateOpenAIResponse(prompt, streamFn) {
    try {
        const openai = require('openai');
        const client = new openai.OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        const stream = await client.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            stream: true,
            max_tokens: 2000,
            temperature: 0.7
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                streamFn({
                    type: 'content',
                    content: content,
                    done: false
                });
            }
        }

        console.log('✅ OpenAI response generation completed');

    } catch (error) {
        console.error('❌ OpenAI fallback error:', error);
        streamFn({
            type: 'error',
            error: 'All LLM services unavailable',
            message: 'Both Ollama and OpenAI services are currently unavailable'
        });
    }
}

/**
 * Check if Ollama service is healthy and model is available
 */
async function checkOllamaHealth() {
    try {
        const healthResponse = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
            timeout: 5000
        });

        const availableModels = healthResponse.data.models || [];
        const modelExists = availableModels.some(model =>
            model.name === DEFAULT_MODEL || model.name.startsWith(DEFAULT_MODEL.split(':')[0])
        );

        if (!modelExists) {
            const availableNames = availableModels.map(m => m.name).join(', ');
            throw new Error(`Model "${DEFAULT_MODEL}" not found. Available models: ${availableNames}. Please run: ollama pull ${DEFAULT_MODEL}`);
        }

        console.log(`✅ Ollama health check passed - ${DEFAULT_MODEL} is available`);

    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            throw new Error(`Ollama service is not running at ${OLLAMA_BASE_URL}`);
        }
        throw error;
    }
}

/**
 * Utility function to truncate context if it's too long
 */
function truncateContext(context, maxLength = 4000) {
    if (context.length <= maxLength) return context;
    return context.substring(0, maxLength - 100) + '\n... (context truncated for length)';
}

module.exports = chatTool;