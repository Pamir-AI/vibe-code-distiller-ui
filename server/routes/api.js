const express = require('express');
const config = require('config');
const router = express.Router();
const logger = require('../utils/logger');
const { SUCCESS_MESSAGES } = require('../utils/constants');
const path = require('path');
const TmuxUtils = require('../utils/tmux-utils');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// API status endpoint
router.get('/status', (req, res) => {
  const uptime = process.uptime();
  const memory = process.memoryUsage();
  
  res.json({
    success: true,
    status: 'operational',
    uptime: {
      seconds: Math.floor(uptime),
      human: formatUptime(uptime)
    },
    memory: {
      used: Math.round(memory.heapUsed / 1024 / 1024),
      total: Math.round(memory.heapTotal / 1024 / 1024),
      external: Math.round(memory.external / 1024 / 1024),
      rss: Math.round(memory.rss / 1024 / 1024)
    },
    process: {
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch
    },
    timestamp: new Date().toISOString()
  });
});

// API version endpoint
router.get('/version', (req, res) => {
  res.json({
    success: true,
    version: '1.0.0',
    name: 'Claude Code Web Manager',
    description: 'Professional web interface for managing Claude Code CLI projects',
    api: {
      version: 'v1',
      endpoints: [
        'GET /api/status',
        'GET /api/version',
        'GET /api/projects',
        'POST /api/projects',
        'GET /api/projects/:id',
        'PUT /api/projects/:id',
        'DELETE /api/projects/:id',
        'POST /api/claude/:projectId/start',
        'POST /api/claude/:projectId/stop',
        'GET /api/claude/:projectId/status',
        'POST /api/notification',
        'GET /api/system/status',
        'GET /api/system/logs',
        'GET /api/sessions',
        'DELETE /api/sessions/:sessionName',
        'POST /api/terminal/send-input',
        'POST /api/terminal/send-key',
        'POST /api/terminal/scroll',
        'POST /api/terminal/exit-copy-mode',
        'POST /api/terminal/go-to-bottom-and-exit'
      ]
    }
  });
});

// API documentation endpoint
router.get('/docs', (req, res) => {
  res.json({
    success: true,
    documentation: {
      title: 'Claude Code Web Manager API',
      version: '1.0.0',
      description: 'RESTful API for managing Claude Code projects and sessions',
      baseUrl: `${req.protocol}://${req.get('host')}/api`,
      authentication: 'None',
      
      endpoints: {
        projects: {
          'GET /projects': {
            description: 'Get all projects',
            parameters: {
              limit: 'number (optional) - Maximum number of projects to return',
              offset: 'number (optional) - Number of projects to skip',
              type: 'string (optional) - Filter by project type'
            },
            response: 'Array of project objects'
          },
          'POST /projects': {
            description: 'Create a new project',
            body: {
              name: 'string (required) - Project name',
              description: 'string (optional) - Project description',
              type: 'string (optional) - Project type',
              language: 'string (optional) - Programming language',
              framework: 'string (optional) - Framework name'
            },
            response: 'Created project object'
          },
          'GET /projects/:id': {
            description: 'Get project by ID',
            parameters: { id: 'string - Project ID' },
            response: 'Project object'
          },
          'PUT /projects/:id': {
            description: 'Update project',
            parameters: { id: 'string - Project ID' },
            body: 'Partial project object',
            response: 'Updated project object'
          },
          'DELETE /projects/:id': {
            description: 'Delete project',
            parameters: { id: 'string - Project ID' },
            response: 'Success confirmation'
          }
        },
        
        claude: {
          'POST /claude/:projectId/start': {
            description: 'Start Claude Code session for project',
            parameters: { projectId: 'string - Project ID' },
            response: 'Session information'
          },
          'POST /claude/:projectId/stop': {
            description: 'Stop Claude Code session',
            parameters: { projectId: 'string - Project ID' },
            response: 'Success confirmation'
          },
          'GET /claude/:projectId/status': {
            description: 'Get Claude Code session status',
            parameters: { projectId: 'string - Project ID' },
            response: 'Session status information'
          }
        },
        
        notifications: {
          'POST /notification': {
            description: 'Receive Claude Code notification hooks',
            body: {
              session_id: 'string - Claude session ID',
              transcript_path: 'string - Path to conversation transcript',
              message: 'string - Notification message',
              title: 'string - Notification title'
            },
            response: 'Success confirmation with notification details'
          }
        },
        
        system: {
          'GET /system/status': {
            description: 'Get system status and metrics',
            response: 'System status object'
          },
          'GET /system/logs': {
            description: 'Get application logs',
            parameters: {
              level: 'string (optional) - Log level filter',
              limit: 'number (optional) - Maximum number of log entries',
              since: 'string (optional) - ISO timestamp to filter logs since'
            },
            response: 'Array of log entries'
          }
        }
      },
      
      websocket: {
        url: `ws://${req.get('host')}`,
        events: {
          client_to_server: [
            'join-project - Join a project room',
            'leave-project - Leave a project room',
            'terminal-input - Send input to terminal',
            'terminal-resize - Resize terminal',
            'claude-command - Send command to Claude'
          ],
          server_to_client: [
            'terminal-output - Terminal output data',
            'claude-response - Claude response',
            'project-status - Project status update',
            'system-status - System status update',
            'error - Error message',
            'notification - System notification',
            'claude-notification - Claude Code hook notifications'
          ]
        }
      },
      
      errors: {
        format: {
          success: false,
          error: 'Error message',
          code: 'ERROR_CODE',
          details: 'Additional error details (optional)',
          timestamp: 'ISO timestamp'
        },
        codes: [
          'VALIDATION_ERROR - Invalid input data',
          'NOT_FOUND - Resource not found',
          'PROJECT_NOT_FOUND - Project does not exist',
          'CLAUDE_SESSION_FAILED - Failed to start Claude session',
          'TERMINAL_CREATE_FAILED - Failed to create terminal',
          'SYSTEM_OVERLOAD - System resources exhausted'
        ]
      }
    }
  });
});

// Claude Code notification endpoint
router.post('/notification', (req, res) => {
  try {
    const { session_id, transcript_path, message, title } = req.body;
    
    // Extract project name from transcript path
    let projectName = 'Current Project';
    if (transcript_path) {
      const pathSegments = transcript_path.split('/');
      // Find the segment that contains the project (usually the parent directory of .claude)
      const claudeIndex = pathSegments.findIndex(segment => segment === '.claude');
      if (claudeIndex > 0) {
        projectName = pathSegments[claudeIndex - 1];
      }
    }
    
    // Create notification object
    const notification = {
      sessionId: session_id,
      projectName,
      message: message || 'Claude Code notification',
      title: title || 'Claude Code',
      timestamp: new Date().toISOString()
    };
    
    // Broadcast to all connected clients via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('claude-notification', notification);
      logger.info(`Notification sent to all clients: ${message} (Project: ${projectName})`);
    }
    
    res.json({
      success: true,
      message: 'Notification sent successfully',
      notification
    });
    
  } catch (error) {
    logger.error('Error processing notification:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process notification',
      details: error.message
    });
  }
});

// Get all claude-web sessions
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await TmuxUtils.listSessions();
    const sessionInfos = [];
    
    for (const sessionName of sessions) {
      // 过滤掉base-session，确保用户永远看不到
      if (sessionName === 'base-session' || !sessionName.startsWith('claude-web-')) {
        continue;
      }
      
      const info = await TmuxUtils.getSessionInfo(sessionName);
      const parsed = TmuxUtils.parseSessionName(sessionName);
      
      sessionInfos.push({
        name: sessionName,
        projectId: parsed ? parsed.projectId : null,
        identifier: parsed ? parsed.identifier : null,
        created: info ? info.created : null,
        attached: info ? info.attached : false
      });
    }
    
    res.json({
      success: true,
      sessions: sessionInfos
    });
  } catch (error) {
    logger.error('Error getting sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sessions',
      details: error.message
    });
  }
});

// Delete a session
router.delete('/sessions/:sessionName', async (req, res) => {
  try {
    const { sessionName } = req.params;
    
    // 防止删除base-session
    if (sessionName === 'base-session') {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete base session',
        details: 'base-session is a system session and cannot be deleted'
      });
    }
    
    // Validate session name format
    if (!sessionName.startsWith('claude-web-')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session name format',
        details: 'Session name must start with claude-web-'
      });
    }
    
    const result = await TmuxUtils.killSession(sessionName);
    
    if (result) {
      // Broadcast session deletion to all connected clients
      const io = req.app.get('io');
      if (io) {
        io.emit('session-deleted', { sessionName });
      }
      
      res.json({
        success: true,
        message: 'Session deleted successfully',
        sessionName
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to delete session',
        sessionName
      });
    }
  } catch (error) {
    logger.error('Error deleting session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete session',
      details: error.message
    });
  }
});

// Send text input to a terminal session
router.post('/terminal/send-input', async (req, res) => {
  try {
    const { sessionName, text } = req.body;
    
    // Validate required parameters
    if (!sessionName || !text) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
        details: 'Both sessionName and text are required'
      });
    }
    
    // 防止发送到base-session
    if (sessionName === 'base-session') {
      return res.status(400).json({
        success: false,
        error: 'Cannot send input to base session',
        details: 'base-session is a system session and should not receive input'
      });
    }
    
    // Validate session name format
    if (!sessionName.startsWith('claude-web-')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session name format',
        details: 'Session name must start with claude-web-'
      });
    }
    
    // Check if session exists before trying to send input
    const sessionExists = await TmuxUtils.hasSession(sessionName);
    
    if (!sessionExists) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        details: `Terminal session '${sessionName}' does not exist`
      });
    }
    
    // Escape text for safe shell execution
    const escapedText = text.replace(/"/g, '\\"');
    
    // Use tmux send-keys to send text to the terminal session (without Enter)
    const command = `tmux send-keys -t "${sessionName}" "${escapedText}"`;
    logger.info('Sending text to terminal (without executing):', { sessionName, text: text.substring(0, 100) + (text.length > 100 ? '...' : '') });
    
    await execAsync(command);
    
    logger.info('Text sent successfully to terminal:', { sessionName });
    
    res.json({
      success: true,
      message: 'Text sent to terminal successfully',
      sessionName,
      textLength: text.length
    });
    
  } catch (error) {
    logger.error('Error sending text to terminal:', {
      sessionName: req.body.sessionName,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to send text to terminal',
      details: error.message
    });
  }
});

// Terminal scrolling API
router.post('/terminal/scroll', async (req, res) => {
  try {
    const { sessionName, direction, mode = 'page' } = req.body;
    
    // Validate required parameters
    if (!sessionName || !direction) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: sessionName and direction'
      });
    }
    
    // Validate direction
    if (!['up', 'down'].includes(direction)) {
      return res.status(400).json({
        success: false,
        error: 'Direction must be "up" or "down"'
      });
    }
    
    // Validate session name format
    if (!sessionName.startsWith('claude-web-')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session name format'
      });
    }
    
    // Check if session exists
    const sessionExists = await TmuxUtils.hasSession(sessionName);
    if (!sessionExists) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        details: `Terminal session '${sessionName}' does not exist`
      });
    }
    
    // Execute scroll
    const success = await TmuxUtils.scrollInCopyMode(sessionName, direction, mode);
    
    if (success) {
      logger.info('Terminal scroll executed successfully:', { sessionName, direction, mode });
      res.json({
        success: true,
        message: `Scrolled ${direction} in ${mode} mode`,
        sessionName,
        direction,
        mode
      });
    } else {
      throw new Error('Failed to execute scroll command');
    }
    
  } catch (error) {
    logger.error('Error scrolling terminal:', {
      sessionName: req.body.sessionName,
      direction: req.body.direction,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Exit copy mode API (used by frontend auto-exit timer)
router.post('/terminal/exit-copy-mode', async (req, res) => {
  try {
    const { sessionName } = req.body;
    
    if (!sessionName || !sessionName.startsWith('claude-web-')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session name'
      });
    }
    
    const sessionExists = await TmuxUtils.hasSession(sessionName);
    if (!sessionExists) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    const success = await TmuxUtils.exitCopyMode(sessionName);
    
    res.json({
      success,
      message: success ? 'Exited copy mode' : 'Failed to exit copy mode'
    });
    
  } catch (error) {
    logger.error('Error exiting copy mode:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Go to bottom and exit copy mode API
router.post('/terminal/go-to-bottom-and-exit', async (req, res) => {
  try {
    const { sessionName } = req.body;
    
    // Validate required parameters
    if (!sessionName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: sessionName'
      });
    }
    
    // Validate session name format
    if (!sessionName.startsWith('claude-web-')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session name format'
      });
    }
    
    // Check if session exists
    const sessionExists = await TmuxUtils.hasSession(sessionName);
    if (!sessionExists) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        details: `Terminal session '${sessionName}' does not exist`
      });
    }
    
    // Execute go to bottom and exit
    const success = await TmuxUtils.goToBottomAndExit(sessionName);
    
    if (success) {
      logger.info('Go to bottom and exit executed successfully:', { sessionName });
      res.json({
        success: true,
        message: 'Jumped to bottom and exited copy mode',
        sessionName
      });
    } else {
      throw new Error('Failed to execute go to bottom and exit command');
    }
    
  } catch (error) {
    logger.error('Error in go to bottom and exit:', {
      sessionName: req.body.sessionName,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Send special key to terminal session
router.post('/terminal/send-key', async (req, res) => {
  try {
    const { sessionName, key, modifiers = {} } = req.body;
    
    // Validate required parameters
    if (!sessionName || !key) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
        details: 'Both sessionName and key are required'
      });
    }
    
    // Prevent sending to base-session
    if (sessionName === 'base-session') {
      return res.status(400).json({
        success: false,
        error: 'Cannot send key to base session',
        details: 'base-session is a system session and should not receive input'
      });
    }
    
    // Validate session name format
    if (!sessionName.startsWith('claude-web-')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session name format',
        details: 'Session name must start with claude-web-'
      });
    }
    
    // Check if session exists
    const sessionExists = await TmuxUtils.hasSession(sessionName);
    if (!sessionExists) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        details: `Terminal session '${sessionName}' does not exist`
      });
    }
    
    // Build tmux key code
    let tmuxKey = key;
    if (modifiers.ctrl) tmuxKey = `C-${key.toLowerCase()}`;
    if (modifiers.shift) tmuxKey = `S-${key.toLowerCase()}`;
    if (modifiers.alt) tmuxKey = `M-${key.toLowerCase()}`;
    
    // Validate key format
    const validKeys = [
      'Enter', 'Escape', 'Up', 'Down', 'Left', 'Right',
      'PPage', 'NPage', 'Home', 'End', 'Tab', 'Space',
      'Backspace', 'Delete', 'F1', 'F2', 'F3', 'F4',
      'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
    ];
    
    const baseKey = key.replace(/^[CSM]-/, ''); // Remove modifier prefixes for validation
    if (!validKeys.includes(baseKey) && !modifiers.ctrl && !modifiers.shift && !modifiers.alt) {
      return res.status(400).json({
        success: false,
        error: 'Invalid key',
        details: `Key '${key}' is not supported. Valid keys: ${validKeys.join(', ')}`
      });
    }
    
    // Send key to terminal using tmux
    const command = `tmux send-keys -t "${sessionName}" '${tmuxKey}'`;
    logger.info('Sending key to terminal:', { sessionName, key, tmuxKey });
    
    await execAsync(command);
    
    logger.info('Key sent successfully to terminal:', { sessionName, key: tmuxKey });
    
    res.json({
      success: true,
      message: 'Key sent to terminal successfully',
      sessionName,
      key: tmuxKey
    });
    
  } catch (error) {
    logger.error('Error sending key to terminal:', {
      sessionName: req.body.sessionName,
      key: req.body.key,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to send key to terminal',
      details: error.message
    });
  }
});

// Helper function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

module.exports = router;