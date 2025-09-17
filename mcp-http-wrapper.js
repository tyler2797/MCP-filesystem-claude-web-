#!/usr/bin/env node

import express from 'express';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import cors from 'cors';

const app = express();
const PORT = 3020;

// Enable CORS for Claude.ai
app.use(cors({
  origin: ['https://claude.ai', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin']
}));

app.use(express.json());

// Store active MCP server instances
const mcpInstances = new Map();

// Simple response handler
function waitForResponse(instance, requestId, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkBuffer = () => {
      // Look for complete JSON responses in buffer
      const lines = instance.buffer.split('\n');

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const response = JSON.parse(line);
          if (response.id === requestId) {
            // Remove this line from buffer
            instance.buffer = lines.slice(i + 1).join('\n');
            return resolve(response);
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }

      // Check timeout
      if (Date.now() - startTime > timeout) {
        return reject(new Error('MCP response timeout'));
      }

      // Continue checking
      setTimeout(checkBuffer, 50);
    };

    checkBuffer();
  });
}

// MCP HTTP endpoint - Simple proxy
app.post('/mcp', async (req, res) => {
  try {
    console.log('📨 MCP Request:', JSON.stringify(req.body, null, 2));

    const sessionId = req.headers['x-session-id'] || 'default-session';
    let instance = mcpInstances.get(sessionId);

    // Create new instance if needed
    if (!instance) {
      console.log(`🚀 Creating new MCP instance: ${sessionId}`);

      const mcpServer = spawn('npx', [
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '/home/tyler/claude-workspace'
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      instance = {
        process: mcpServer,
        buffer: ''
      };

      // Capture stdout
      mcpServer.stdout.on('data', (data) => {
        instance.buffer += data.toString();
      });

      mcpServer.stderr.on('data', (data) => {
        console.error('🔴 MCP stderr:', data.toString());
      });

      mcpServer.on('close', (code) => {
        console.log(`🔚 MCP process ${sessionId} closed with code ${code}`);
        mcpInstances.delete(sessionId);
      });

      mcpInstances.set(sessionId, instance);
    }

    // Forward request to MCP server
    const requestData = JSON.stringify(req.body) + '\n';
    instance.process.stdin.write(requestData);

    // Handle notifications (no response expected)
    if (req.body.method && req.body.method.startsWith('notifications/')) {
      console.log('📢 Notification sent, no response expected');
      return res.json({ success: true });
    }

    // Wait for response for regular requests
    const response = await waitForResponse(instance, req.body.id);

    console.log('📤 MCP Response:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (error) {
    console.error('❌ MCP error:', error);
    res.status(500).json({
      jsonrpc: "2.0",
      id: req.body.id || null,
      error: {
        code: -32603,
        message: error.message
      }
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeSessions: mcpInstances.size,
    timestamp: new Date().toISOString()
  });
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('🔚 Shutting down MCP instances...');
  for (const [sessionId, instance] of mcpInstances) {
    instance.process.kill();
  }
  process.exit(0);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 MCP HTTP Wrapper (FIXED) running on http://127.0.0.1:${PORT}/mcp`);
  console.log(`📊 Health check: http://127.0.0.1:${PORT}/health`);
  console.log(`🏠 MCP Workspace: /home/tyler/claude-workspace`);
});