// models/index.js - Mongoose Models
const mongoose = require('mongoose');

// Schema Upload Model
const schemaUploadSchema = new mongoose.Schema({
    projectId: {
        type: String,
        required: true,
        index: true
    },
    userId: {
        type: String,
        required: true
    },
    fileName: {
        type: String,
        required: true
    },
    fileType: {
        type: String,
        required: true
    },
    fileSize: {
        type: Number,
        required: true
    },
    extractedText: {
        type: String,
        required: true
    },
    chunksStored: {
        type: Number,
       
    },
    uploadedAt: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    }
});

// Conversation Model
const conversationSchema = new mongoose.Schema({
    projectId: {
        type: String,
        required: true,
        index: true
    },
    userId: {
        type: String,
        required: true
    },
    userMessage: {
        type: String,
        required: true
    },
    assistantResponse: {
        type: String,
        required: true
    },
    contextUsed: [{
        text: String,
        similarity: Number,
        metadata: mongoose.Schema.Types.Mixed
    }],
    model: {
        type: String,
        default: 'llama3.2:1b-instruct-q4_K_M'
    },
    responseTime: {
        type: Number // in milliseconds
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Project Statistics Model
const projectStatsSchema = new mongoose.Schema({
    projectId: {
        type: String,
        required: true,
        unique: true
    },
    totalSchemas: {
        type: Number,
        default: 0
    },
    totalConversations: {
        type: Number,
        default: 0
    },
    lastActivity: {
        type: Date,
        default: Date.now
    },
    users: [{
        userId: String,
        lastActive: Date
    }]
});

// Create models
const SchemaUpload = mongoose.model('SchemaUpload', schemaUploadSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);
const ProjectStats = mongoose.model('ProjectStats', projectStatsSchema);

module.exports = {
    SchemaUpload,
    Conversation,
    ProjectStats
};