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

// MCP HTTP endpoint
app.post('/mcp', async (req, res) => {
  try {
    console.log('📨 Received MCP request:', JSON.stringify(req.body, null, 2));
    
    // For initialize requests, create new MCP server instance
    if (req.body.method === 'initialize') {
      const sessionId = randomUUID();
      
      // Start MCP server process (Anthropic official version)
      const mcpServer = spawn('npx', [
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '/home/tyler/claude-workspace'
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      // Store the instance
      mcpInstances.set(sessionId, {
        process: mcpServer,
        requests: new Map()
      });
      
      console.log(`🚀 Created MCP instance: ${sessionId}`);
      
      // Set up process handlers
      mcpServer.stdout.on('data', (data) => {
        try {
          const lines = data.toString().split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
              const response = JSON.parse(line);
              const instance = mcpInstances.get(sessionId);
              
              console.log(`📤 MCP Response for session ${sessionId}:`, JSON.stringify(response, null, 2));
              
              if (response.id !== undefined && instance) {
                // Store response for matching with HTTP request
                instance.requests.set(response.id, response);
                
                // If this is an initialize response, enrich it with tools
                if (response.result && response.result.capabilities) {
                  console.log('🔧 Enriching initialize response with tools list...');
                  
                  // Auto-trigger tools/list to get available tools
                  const toolsRequest = {
                    jsonrpc: "2.0",
                    id: "tools-" + randomUUID(),
                    method: "tools/list"
                  };
                  
                  mcpServer.stdin.write(JSON.stringify(toolsRequest) + '\n');
                }
              }
            } catch (parseError) {
              console.log('🔴 MCP Error:', line);
            }
          }
        } catch (error) {
          console.error('❌ Error processing MCP output:', error);
        }
      });
      
      mcpServer.stderr.on('data', (data) => {
        console.error('🔴 MCP stderr:', data.toString());
      });
      
      mcpServer.on('close', (code) => {
        console.log(`🔚 MCP process ${sessionId} closed with code ${code}`);
        mcpInstances.delete(sessionId);
      });
      
      // Store request and send to MCP server
      const instance = mcpInstances.get(sessionId);
      instance.requests.set(req.body.id, null); // Mark as pending
      
      mcpServer.stdin.write(JSON.stringify(req.body) + '\n');
      
      // Wait for response
      const waitForResponse = () => {
        return new Promise((resolve, reject) => {
          const checkResponse = () => {
            const response = instance.requests.get(req.body.id);
            if (response !== null && response !== undefined) {
              // Check if we need to inject tools into capabilities
              if (response.result && response.result.capabilities && !response.result.tools) {
                // Wait a bit for tools/list response
                setTimeout(() => {
                  // Look for tools response
                  let toolsResponse = null;
                  for (const [id, resp] of instance.requests.entries()) {
                    if (id.startsWith('tools-') && resp && resp.result && resp.result.tools) {
                      toolsResponse = resp;
                      break;
                    }
                  }
                  
                  if (toolsResponse) {
                    console.log(`✅ Injected ${toolsResponse.result.tools.length} tools into capabilities`);
                    response.result.capabilities.tools = {};
                    response.result.tools = toolsResponse.result.tools;
                  }
                  
                  console.log('✅ Sending response for request ID:', req.body.id);
                  resolve(response);
                }, 500);
              } else {
                resolve(response);
              }
            } else {
              setTimeout(checkResponse, 100);
            }
          };
          checkResponse();
          
          // Timeout after 10 seconds
          setTimeout(() => {
            reject(new Error('Timeout waiting for MCP response'));
          }, 10000);
        });
      };
      
      try {
        const response = await waitForResponse();
        res.json(response);
      } catch (error) {
        console.error('❌ Error waiting for MCP response:', error);
        res.status(500).json({ error: 'MCP server timeout' });
      }
      
    } else {
      // For non-initialize requests, find existing session or use most recent
      let targetSession = null;
      
      // Try to find session by some heuristic (use most recent for now)
      if (mcpInstances.size > 0) {
        targetSession = Array.from(mcpInstances.keys())[mcpInstances.size - 1];
        console.log(`🔄 Using most recent session: ${targetSession} for request: ${req.body.method}`);
      } else {
        console.error('❌ No active MCP sessions found');
        return res.status(500).json({ error: 'No active MCP session' });
      }
      
      const instance = mcpInstances.get(targetSession);
      if (!instance) {
        return res.status(500).json({ error: 'Session not found' });
      }
      
      // For notifications, just forward them
      if (req.body.method && req.body.method.startsWith('notifications/')) {
        console.log(`📢 Sending notification: ${req.body.method}`);
        instance.process.stdin.write(JSON.stringify(req.body) + '\n');
        
        // Auto-trigger tools/list after initialization
        if (req.body.method === 'notifications/initialized') {
          console.log('🔧 Auto-triggering tools/list after initialization');
          const toolsRequest = {
            jsonrpc: "2.0",
            id: "auto-tools-list",
            method: "tools/list"
          };
          instance.process.stdin.write(JSON.stringify(toolsRequest) + '\n');
        }
        
        return res.json({ success: true });
      }
      
      // For regular requests, wait for response
      const requestId = req.body.id || randomUUID();
      const requestWithId = { ...req.body, id: requestId };
      
      instance.requests.set(requestId, null); // Mark as pending
      instance.process.stdin.write(JSON.stringify(requestWithId) + '\n');
      
      // Wait for response
      const waitForResponse = () => {
        return new Promise((resolve, reject) => {
          const checkResponse = () => {
            const response = instance.requests.get(requestId);
            if (response !== null && response !== undefined) {
              resolve(response);
            } else {
              setTimeout(checkResponse, 100);
            }
          };
          checkResponse();
          
          setTimeout(() => {
            reject(new Error('Timeout waiting for MCP response'));
          }, 10000);
        });
      };
      
      try {
        const response = await waitForResponse();
        res.json(response);
      } catch (error) {
        console.error('❌ Error waiting for MCP response:', error);
        res.status(500).json({ error: 'MCP server timeout' });
      }
    }
    
  } catch (error) {
    console.error('❌ MCP request error:', error);
    res.status(500).json({ error: error.message });
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
  console.log(`🚀 MCP HTTP Wrapper running on http://127.0.0.1:${PORT}/mcp`);
  console.log(`📊 Health check: http://127.0.0.1:${PORT}/health`);
  console.log(`🏠 MCP Workspace: /home/tyler/claude-workspace`);
});