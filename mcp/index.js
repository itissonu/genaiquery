// index.js - Updated MCP-Compatible Tool Server with MongoDB
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const mongoose = require('mongoose');
const chatTool = require('./tools/chatTool.js');
const { initializeVectorStore, storeSchemaEmbeddings, searchSimilarChunks } = require('./utils/vectorStore.js');
const { generateEmbeddings} = require('./utils/embed.js');
const { extractText } = require('./utils/extractText.js');
const { SchemaUpload, Conversation, ProjectStats } = require('./models/index.js');

const app = express();
const PORT = process.env.PORT || 3002;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/schema_chat_db';

// MongoDB Connection
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ Connected to MongoDB');
}).catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
});

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './uploads';
        require('fs').mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}_${sanitizedName}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, 
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.sql', '.json', '.prisma', '.csv', '.php', '.go', '.java', '.js', '.ts', '.py', '.rb', '.xml', '.yaml', '.yml'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${ext}. Allowed: ${allowedTypes.join(', ')}`));
        }
    }
});

// Initialize vector store on startup
let vectorStore;
(async () => {
    try {
        vectorStore = await initializeVectorStore();
        console.log('✅ Vector store initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize vector store:', error.message);
        process.exit(1);
    }
})();

/**
 * MCP-compliant task endpoint
 */
app.post('/task', async (req, res) => {
    const { task, input, projectId, userId } = req.body;

    if (!task || !input || !projectId) {
        return res.status(400).json({
            error: 'Missing required fields: task, input, projectId'
        });
    }

    console.log(`📝 Processing task: ${task} for project: ${projectId}`);

    try {
        switch (task) {
            case 'chat':
                await handleChatTask(req, res, input, projectId, userId);
                break;
            
            default:
                res.status(400).json({
                    error: `Unsupported task type: ${task}`,
                    supportedTasks: ['chat']
                });
        }
    } catch (error) {
        console.error(`❌ Error processing task ${task}:`, error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

async function handleChatTask(req, res, input, projectId, userId) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    let fullResponse = '';
    const startTime = Date.now();

    const streamFn = (data) => {
        const chunk = typeof data === 'string' ? data : JSON.stringify(data);
        res.write(`data: ${chunk}\n\n`);
        
        // Collect response content for storage
        if (typeof data === 'object' && data.content) {
            fullResponse += data.content;
        }
    };

    try {
        // Get conversation history before processing
        const conversationHistory = await getConversationHistory(projectId, userId);
        
        // Use the chat tool to handle the request
        const contextUsed = await chatTool(input, projectId, userId, streamFn, conversationHistory);
        
        // Store conversation in MongoDB
        await saveConversation({
            projectId,
            userId,
            userMessage: input,
            assistantResponse: fullResponse,
            contextUsed,
            responseTime: Date.now() - startTime
        });
        
        // Update project stats
        await updateProjectStats(projectId, userId);
        
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error) {
        console.error('❌ Chat tool error:', error);
        streamFn({ error: 'Failed to process chat request', message: error.message });
        res.write('data: [DONE]\n\n');
        res.end();
    }
}

/**
 * Updated schema upload endpoint with MongoDB storage
 */
app.post('/upload-schema', upload.single('file'), async (req, res) => {
    let filePath = null;
    
    try {
        const { projectId, userId } = req.body;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                error: 'projectId is required'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        filePath = req.file.path;
        const fileExtension = path.extname(req.file.originalname).toLowerCase();
        const originalName = req.file.originalname;
        const fileSize = req.file.size;

        console.log(`Processing schema file: ${originalName} (${fileSize} bytes) for project: ${projectId}`);

        // Extract text content
        const extractedText = await extractText(filePath, originalName);
        
        if (!extractedText || extractedText.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No text content could be extracted from the file'
            });
        }

        // Split text into chunks
        const chunks = splitIntoChunks(extractedText, 500, 50);
        
        if (chunks.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid chunks could be created from the file content'
            });
        }

        console.log(`Created ${chunks.length} text chunks from ${originalName}`);

        // Store embeddings in vector store
        const storedCount = await storeSchemaEmbeddings(vectorStore, projectId, chunks, {
            filename: req.file.originalname,
            uploadedBy: userId,
            uploadedAt: new Date().toISOString(),
            fileType: fileExtension
        });

        // Save schema upload to MongoDB
        const schemaUpload = new SchemaUpload({
            projectId,
            userId,
            fileName: originalName,
            fileType: fileExtension,
            fileSize,
            extractedText,
            chunksStored: storedCount
        });
        
        await schemaUpload.save();
        console.log('✅ Schema upload saved to MongoDB');

        // Update project stats
        await updateProjectStats(projectId, userId);

        // Clean up uploaded file
        await fs.unlink(filePath);
        filePath = null;

        res.json({
            success: true,
            message: 'Schema uploaded and processed successfully',
            data: {
                projectId,
                fileName: originalName,
                chunksStored: storedCount,
                fileSize: fileSize,
                uploadId: schemaUpload._id
            }
        });

    } catch (error) {
        console.error('Error processing schema upload:', error);
        
        if (filePath) {
            try {
                await fs.unlink(filePath);
            } catch (cleanupError) {
                console.error('Error cleaning up file:', cleanupError);
            }
        }

        res.status(500).json({
            success: false,
            error: 'Internal server error while processing schema',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * Get project information including uploaded schemas and conversation count
 */
app.get('/project/:projectId/info', async (req, res) => {
    const { projectId } = req.params;

    try {
        const [schemas, stats, conversationCount] = await Promise.all([
            SchemaUpload.find({ projectId, isActive: true }).sort({ uploadedAt: -1 }),
            ProjectStats.findOne({ projectId }),
            Conversation.countDocuments({ projectId })
        ]);

        res.json({
            projectId,
            schemas: schemas.map(schema => ({
                id: schema._id,
                fileName: schema.fileName,
                fileType: schema.fileType,
                fileSize: schema.fileSize,
                chunksStored: schema.chunksStored,
                uploadedAt: schema.uploadedAt,
                uploadedBy: schema.userId
            })),
            stats: {
                totalSchemas: stats?.totalSchemas || 0,
                totalConversations: conversationCount,
                lastActivity: stats?.lastActivity,
                users: stats?.users || []
            }
        });
    } catch (error) {
        console.error('❌ Error fetching project info:', error);
        res.status(500).json({
            error: 'Failed to fetch project information',
            message: error.message
        });
    }
});

/**
 * Get conversation history for a project
 */
app.get('/project/:projectId/conversations', async (req, res) => {
    const { projectId } = req.params;
    const { userId, limit = 20, offset = 0 } = req.query;

    try {
        const query = { projectId };
        if (userId) query.userId = userId;

        const conversations = await Conversation.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(offset))
            .select('-contextUsed'); // Exclude heavy context data

        const total = await Conversation.countDocuments(query);

        res.json({
            conversations,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: (parseInt(offset) + parseInt(limit)) < total
            }
        });
    } catch (error) {
        console.error('❌ Error fetching conversations:', error);
        res.status(500).json({
            error: 'Failed to fetch conversations',
            message: error.message
        });
    }
});

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
    try {
        // Test MongoDB connection
        const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        
        // Test vector store
        const vectorStatus = vectorStore ? 'connected' : 'disconnected';
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                mongodb: mongoStatus,
                vectorStore: vectorStatus,
                ollama: 'not_checked'
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Helper Functions

/**
 * Get recent conversation history for context
 */
async function getConversationHistory(projectId, userId, limit = 5) {
    try {
        const conversations = await Conversation.find({ 
            projectId, 
            ...(userId && { userId }) 
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('userMessage assistantResponse createdAt');
        
        return conversations.reverse(); // Return in chronological order
    } catch (error) {
        console.error('Error fetching conversation history:', error);
        return [];
    }
}

/**
 * Save conversation to MongoDB
 */
async function saveConversation(conversationData) {
    try {
        const conversation = new Conversation(conversationData);
        await conversation.save();
        console.log('✅ Conversation saved to MongoDB');
        return conversation;
    } catch (error) {
        console.error('Error saving conversation:', error);
        throw error;
    }
}

/**
 * Update project statistics
 */
async function updateProjectStats(projectId, userId) {
    try {
        const stats = await ProjectStats.findOneAndUpdate(
            { projectId },
            {
                $inc: { totalConversations: 1 },
                lastActivity: new Date(),
                $addToSet: { 
                    users: { userId, lastActive: new Date() }
                }
            },
            { upsert: true, new: true }
        );
        
        // Update schema count
        const schemaCount = await SchemaUpload.countDocuments({ projectId, isActive: true });
        stats.totalSchemas = schemaCount;
        await stats.save();
        
    } catch (error) {
        console.error('Error updating project stats:', error);
    }
}

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

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 MCP Tool Server running on http://localhost:${PORT}`);
    console.log(`📡 Ready to handle schema-aware chat requests`);
    console.log(`🔧 Available endpoints:`);
    console.log(`   POST /task - MCP-compliant task processor`);
    console.log(`   POST /upload-schema - Schema file upload`);
    console.log(`   GET  /project/:id/info - Project information`);
    console.log(`   GET  /project/:id/conversations - Conversation history`);
    console.log(`   GET  /health - Health check`);
});

module.exports = app;