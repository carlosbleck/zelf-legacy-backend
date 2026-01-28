import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { livenessRouter } from './routes/liveness.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/liveness', livenessRouter);

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: err.message || 'Internal server error',
        success: false
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Light Protocol Backend running on port ${PORT}`);
    console.log(`📡 Solana RPC: ${process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'}`);
    console.log(`📋 Program ID: ${process.env.PROGRAM_ID || 'PQ6EV39W9BQECUnf4v7MPbPCxJwgmwvUwrLY67u13QE'}`);
});
