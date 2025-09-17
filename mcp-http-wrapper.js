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
        const responses = data.toString().split('\n').filter(line => line.trim());
        responses.forEach(async response => {
          if (!response.trim()) return;

          try {
            const parsed = JSON.parse(response);
            console.log(`📤 MCP Response for session ${sessionId}:`, JSON.stringify(parsed, null, 2));
            const instance = mcpInstances.get(sessionId);

            // Special handling for initialize response
            if (instance && instance.requests.has(parsed.id)) {
              const { req: originalReq, res: originalRes } = instance.requests.get(parsed.id);

              // If this is an initialize response, enrich with tools
              if (originalReq.body.method === 'initialize' && parsed.result && parsed.result.capabilities) {
                console.log('🔧 Enriching initialize response with tools list...');

                // Create tools/list request
                const toolsRequest = {
                  jsonrpc: '2.0',
                  id: `tools-${randomUUID()}`,
                  method: 'tools/list',
                  params: {}
                };

                // Create a promise to wait for tools response
                const toolsPromise = new Promise((resolve) => {
                  const toolsHandler = (toolsData) => {
                    const toolsResponses = toolsData.toString().split('\n').filter(line => line.trim());
                    for (const toolsResp of toolsResponses) {
                      if (!toolsResp.trim()) continue;
                      try {
                        const toolsParsed = JSON.parse(toolsResp);
                        if (toolsParsed.id === toolsRequest.id && toolsParsed.result && toolsParsed.result.tools) {
                          // Convert array of tools to object indexed by name
                          const toolsMap = {};
                          for (const tool of toolsParsed.result.tools) {
                            const { name, ...metadata } = tool;
                            toolsMap[name] = metadata;
                          }
                          resolve(toolsMap);
                          mcpServer.stdout.removeListener('data', toolsHandler);
                          return;
                        }
                      } catch (e) {
                        // Ignore parse errors
                      }
                    }
                  };
                  mcpServer.stdout.on('data', toolsHandler);

                  // Send tools/list request
                  mcpServer.stdin.write(JSON.stringify(toolsRequest) + '\n');

                  // Timeout after 2 seconds
                  setTimeout(() => {
                    mcpServer.stdout.removeListener('data', toolsHandler);
                    resolve({});
                  }, 2000);
                });

                // Wait for tools and inject them
                const toolsMap = await toolsPromise;
                if (Object.keys(toolsMap).length > 0) {
                  parsed.result.capabilities.tools = toolsMap;
                  console.log(`✅ Injected ${Object.keys(toolsMap).length} tools into capabilities`);
                }
              }

              console.log(`✅ Sending response for request ID: ${parsed.id}`);
              originalRes.json(parsed);
              instance.requests.delete(parsed.id);
            } else {
              console.log(`⚠️ No matching request found for response ID: ${parsed.id}`);
            }
          } catch (e) {
            console.log('📄 MCP output:', response);
          }
        });
      });
      
      mcpServer.stderr.on('data', (data) => {
        console.log('🔴 MCP Error:', data.toString());
      });
      
      mcpServer.on('close', () => {
        console.log(`🔚 MCP instance ${sessionId} closed`);
        mcpInstances.delete(sessionId);
      });
      
      // Store this request with both req and res
      const instance = mcpInstances.get(sessionId);
      instance.requests.set(req.body.id, { req: { body: req.body }, res });
      
      // Send request to MCP server
      mcpServer.stdin.write(JSON.stringify(req.body) + '\n');
      
      // Set session header for client
      res.setHeader('X-Session-Id', sessionId);
      
    } else {
      // For non-initialize requests, use existing session
      let sessionId = req.headers['x-session-id'];
      let instance = mcpInstances.get(sessionId);
      
      // If no session provided or session not found, use the most recent session
      if (!instance && mcpInstances.size > 0) {
        const sessions = Array.from(mcpInstances.keys());
        sessionId = sessions[sessions.length - 1]; // Get most recent session
        instance = mcpInstances.get(sessionId);
        console.log(`🔄 Using most recent session: ${sessionId} for request: ${req.body.method}`);
      }
      
      if (!instance) {
        return res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32004, message: 'Session not found' },
          id: req.body.id
        });
      }
      
      // Handle notifications (no response expected)
      if (req.body.method && req.body.method.startsWith('notifications/')) {
        console.log(`📢 Sending notification: ${req.body.method}`);
        instance.process.stdin.write(JSON.stringify(req.body) + '\n');
        
        // After notifications/initialized, proactively send tools/list to populate Claude Web UI
        if (req.body.method === 'notifications/initialized') {
          console.log(`🔧 Auto-triggering tools/list after initialization`);
          setTimeout(() => {
            const toolsListRequest = {
              jsonrpc: '2.0',
              id: 'auto-tools-list',
              method: 'tools/list',
              params: {}
            };
            instance.process.stdin.write(JSON.stringify(toolsListRequest) + '\n');
          }, 100); // Small delay to ensure notification is processed
        }
        
        // Notifications don't expect responses
        res.status(200).json({ jsonrpc: '2.0' });
        return;
      }
      
      // Store this request for methods that expect responses
      if (req.body.id !== undefined) {
        instance.requests.set(req.body.id, { req, res });
      }
      
      // Send request to MCP server
      instance.process.stdin.write(JSON.stringify(req.body) + '\n');
    }
    
    // Response will be handled asynchronously by stdout handler
    
  } catch (error) {
    console.error('❌ Error handling MCP request:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal server error' },
      id: req.body.id || null
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    activeSessions: mcpInstances.size,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 MCP HTTP Wrapper running on http://127.0.0.1:${PORT}/mcp`);
  console.log(`📊 Health check: http://127.0.0.1:${PORT}/health`);
  console.log(`🏠 MCP Workspace: /home/tyler/claude-workspace`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔚 Shutting down MCP instances...');
  mcpInstances.forEach((instance, sessionId) => {
    instance.process.kill();
  });
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🔚 Shutting down MCP instances...');
  mcpInstances.forEach((instance, sessionId) => {
    instance.process.kill();
  });
  process.exit(0);
});