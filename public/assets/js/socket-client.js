// ===== SOCKET.IO CLIENT =====

class SocketClient extends EventEmitter {
    constructor() {
        super();
        this.socket = null;
        this.connectionStatus = 'disconnected';
        this.currentProject = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        
        this.setupSocket();
    }
    
    setupSocket() {
        // Initialize Socket.IO connection
        this.socket = io({
            transports: ['websocket', 'polling'],
            timeout: 20000,
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: this.reconnectDelay,
            reconnectionDelayMax: 5000,
            maxHttpBufferSize: 1e6, // 1MB
            pingTimeout: 60000,
            pingInterval: 25000
        });
        
        this.setupEventHandlers();
    }
    
    setupEventHandlers() {
        // Connection events
        this.socket.on('connect', () => {
            this.connectionStatus = 'connected';
            this.reconnectAttempts = 0;
            this.updateConnectionStatus();
            this.emit('connected');
            
            console.log('✅ Connected to server');
            notifications.success('Connected to server', { duration: 2000 });
        });
        
        this.socket.on('disconnect', (reason) => {
            this.connectionStatus = 'disconnected';
            this.updateConnectionStatus();
            this.emit('disconnected', reason);
            
            console.log('❌ Disconnected from server:', reason);
            
            if (reason === 'io server disconnect') {
                // Server initiated disconnect, try to reconnect
                this.socket.connect();
            }
        });
        
        this.socket.on('connect_error', (error) => {
            this.connectionStatus = 'error';
            this.reconnectAttempts++;
            this.updateConnectionStatus();
            this.emit('connection_error', error);
            
            console.error('❌ Connection error:', error);
            
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                notifications.error('Failed to connect to server. Please check your connection.', {
                    duration: 0
                });
            }
        });
        
        this.socket.on('reconnect', (attemptNumber) => {
            this.connectionStatus = 'connected';
            this.reconnectAttempts = 0;
            this.updateConnectionStatus();
            this.emit('reconnected', attemptNumber);
            
            console.log('🔄 Reconnected to server (attempt:', attemptNumber, ')');
            notifications.success('Reconnected to server', { duration: 2000 });
            
            // Rejoin current project if any with delay to ensure server is ready
            if (this.currentProject) {
                setTimeout(() => {
                    console.log('🔄 Rejoining project after reconnection:', this.currentProject);
                    this.joinProject(this.currentProject);
                }, 2000); // Wait 2 seconds before rejoining
            }
        });
        
        this.socket.on('reconnect_attempt', (attemptNumber) => {
            this.connectionStatus = 'reconnecting';
            this.updateConnectionStatus();
            console.log('🔄 Attempting to reconnect... (attempt:', attemptNumber, ')');
        });
        
        this.socket.on('reconnect_error', (error) => {
            console.error('❌ Reconnection error:', error);
        });
        
        this.socket.on('reconnect_failed', () => {
            this.connectionStatus = 'failed';
            this.updateConnectionStatus();
            console.error('❌ Reconnection failed');
            notifications.error('Unable to reconnect to server', { duration: 0 });
        });
        
        // Server events
        this.socket.on('connected', (data) => {
            console.log('✅ Server connection confirmed:', data);
            this.emit('server_connected', data);
            
            // Rejoin current project if we have one
            if (this.currentProject) {
                setTimeout(() => {
                    console.log('🔄 Rejoining project after server connection:', this.currentProject);
                    this.joinProject(this.currentProject);
                }, 1000);
            }
        });
        
        this.socket.on('error', (error) => {
            // Handle specific errors without logging
            if (error.message === 'Not connected to project' && this.currentProject) {
                console.log('🔄 Project connection lost, attempting to rejoin:', this.currentProject);
                setTimeout(() => {
                    this.joinProject(this.currentProject);
                }, 1000);
            } else if (error.message === 'Failed to resize terminal' && error.details === 'Terminal session not found') {
                // Terminal session not ready yet, ignore this error
                // This can happen when switching terminals or reconnecting
            } else if (error.message && error.message.includes('Socket is not connected')) {
                // Socket connection error, already handled by connection status
            } else {
                // Log other errors
                console.error('❌ Server error:', error);
                notifications.error(error.message || 'Server error occurred');
            }
            
            this.emit('server_error', error);
        });
        
        this.socket.on('notification', (notification) => {
            this.handleNotification(notification);
            this.emit('notification', notification);
        });
        
        // Project events
        this.socket.on('project-status', (data) => {
            console.log('📁 Project status:', data);
            this.emit('project_status', data);
        });
        
        // Terminal events
        this.socket.on('terminal-output', (data) => {
            this.emit('terminal_output', data);
        });
        
        // Claude Code events
        this.socket.on('claude-response', (data) => {
            this.emit('claude_response', data);
        });
        
        // System events
        this.socket.on('system-status', (data) => {
            this.emit('system_status', data);
        });
    }
    
    updateConnectionStatus() {
        const statusElement = DOM.get('connection-status');
        if (!statusElement) return;
        
        const indicator = statusElement.querySelector('.indicator');
        const text = statusElement.querySelector('.text');
        
        if (indicator && text) {
            // Remove all status classes
            indicator.className = 'indicator';
            
            switch (this.connectionStatus) {
                case 'connected':
                    indicator.classList.add('online');
                    text.textContent = 'Connected';
                    break;
                case 'connecting':
                case 'reconnecting':
                    indicator.classList.add('offline');
                    text.textContent = 'Connecting...';
                    break;
                case 'disconnected':
                    indicator.classList.add('offline');
                    text.textContent = 'Disconnected';
                    break;
                case 'error':
                case 'failed':
                    indicator.classList.add('offline');
                    text.textContent = 'Connection Failed';
                    break;
                default:
                    indicator.classList.add('offline');
                    text.textContent = 'Unknown';
            }
        }
    }
    
    handleNotification(notification) {
        const { type, message, title } = notification;
        
        switch (type) {
            case 'user_joined':
                notifications.info(message, { title: 'User Activity' });
                break;
            case 'user_left':
                notifications.info(message, { title: 'User Activity' });
                break;
            case 'file_changed':
                notifications.info(message, { title: 'File Change', duration: 3000 });
                break;
            case 'file_added':
                notifications.success(message, { title: 'File Added', duration: 3000 });
                break;
            case 'file_removed':
                notifications.warning(message, { title: 'File Removed', duration: 3000 });
                break;
            case 'claude_session_ended':
                notifications.warning(message, { title: 'Claude Session' });
                break;
            case 'terminal_session_ended':
                notifications.warning(message, { title: 'Terminal Session' });
                break;
            default:
                notifications.info(message, { title: title || 'Notification' });
        }
    }
    
    // Connection methods
    connect() {
        if (this.socket.disconnected) {
            this.socket.connect();
        }
    }
    
    disconnect() {
        if (this.socket.connected) {
            this.socket.disconnect();
        }
    }
    
    isConnected() {
        return this.socket && this.socket.connected;
    }
    
    getConnectionStatus() {
        return this.connectionStatus;
    }
    
    // Project methods
    joinProject(projectId) {
        if (!this.isConnected()) {
            console.warn('Cannot join project: not connected to server');
            return false;
        }
        
        this.currentProject = projectId;
        this.socket.emit('join-project', { projectId });
        console.log('📁 Joining project:', projectId);
        return true;
    }
    
    leaveProject(projectId = null) {
        if (!this.isConnected()) {
            console.warn('Cannot leave project: not connected to server');
            return false;
        }
        
        const targetProjectId = projectId || this.currentProject;
        if (targetProjectId) {
            this.socket.emit('leave-project', { projectId: targetProjectId });
            console.log('📁 Leaving project:', targetProjectId);
            
            if (targetProjectId === this.currentProject) {
                this.currentProject = null;
            }
        }
        return true;
    }
    
    getCurrentProject() {
        return this.currentProject;
    }
    
    // Terminal methods
    sendTerminalInput(projectId, input) {
        if (!this.isConnected()) {
            console.warn('Cannot send terminal input: not connected to server');
            return false;
        }
        
        // Ensure we're connected to the project before sending input
        if (this.currentProject !== projectId) {
            console.warn('Project mismatch detected, rejoining project:', projectId);
            this.joinProject(projectId);
            // Delay the input to allow project join to complete
            setTimeout(() => {
                this.socket.emit('terminal-input', { projectId, input });
            }, 500);
            return true;
        }
        
        this.socket.emit('terminal-input', { projectId, input });
        return true;
    }
    
    resizeTerminal(projectId, cols, rows) {
        if (!this.isConnected()) {
            console.warn('Cannot resize terminal: not connected to server');
            return false;
        }
        
        this.socket.emit('terminal-resize', { projectId, cols, rows });
        return true;
    }
    
    // Claude Code methods
    sendClaudeCommand(projectId, command, context = {}) {
        if (!this.isConnected()) {
            console.warn('Cannot send Claude command: not connected to server');
            return false;
        }
        
        this.socket.emit('claude-command', { projectId, command, context });
        return true;
    }
    
    // Project action methods
    sendProjectAction(projectId, action, payload = {}) {
        if (!this.isConnected()) {
            console.warn('Cannot send project action: not connected to server');
            return false;
        }
        
        this.socket.emit('project-action', { projectId, action, payload });
        return true;
    }
    
    startClaude(projectId, options = {}) {
        return this.sendProjectAction(projectId, 'start_claude', options);
    }
    
    stopClaude(projectId, force = false) {
        return this.sendProjectAction(projectId, 'stop_claude', { force });
    }
    
    createTerminal(projectId, options = {}) {
        return this.sendProjectAction(projectId, 'create_terminal', options);
    }
    
    destroyTerminal(projectId) {
        return this.sendProjectAction(projectId, 'destroy_terminal');
    }
    
    // Utility methods
    getSocket() {
        return this.socket;
    }
    
    // Event handler shortcuts
    onTerminalOutput(callback) {
        return this.on('terminal_output', callback);
    }
    
    onClaudeResponse(callback) {
        return this.on('claude_response', callback);
    }
    
    onProjectStatus(callback) {
        return this.on('project_status', callback);
    }
    
    onSystemStatus(callback) {
        return this.on('system_status', callback);
    }
    
    onNotification(callback) {
        return this.on('notification', callback);
    }
    
    onConnected(callback) {
        return this.on('connected', callback);
    }
    
    onDisconnected(callback) {
        return this.on('disconnected', callback);
    }
    
    onReconnected(callback) {
        return this.on('reconnected', callback);
    }
    
    onConnectionError(callback) {
        return this.on('connection_error', callback);
    }
    
    // Authentication methods (if needed)
    authenticate(token) {
        if (this.socket) {
            this.socket.auth = { token };
            if (this.socket.connected) {
                this.socket.disconnect().connect();
            }
        }
    }
    
    // Debugging methods
    enableDebugLogs() {
        this.socket.on('connect', () => console.log('🔌 Socket connected'));
        this.socket.on('disconnect', (reason) => console.log('🔌 Socket disconnected:', reason));
        this.socket.onAny((event, ...args) => {
            console.log('📡 Socket event:', event, args);
        });
    }
    
    getDebugInfo() {
        return {
            connected: this.isConnected(),
            status: this.connectionStatus,
            currentProject: this.currentProject,
            reconnectAttempts: this.reconnectAttempts,
            socketId: this.socket?.id,
            transport: this.socket?.io?.engine?.transport?.name
        };
    }
}

// Error handling for WebSocket events
class SocketErrorHandler {
    constructor(socketClient) {
        this.client = socketClient;
        this.setupErrorHandling();
    }
    
    setupErrorHandling() {
        // Handle specific error types
        this.client.on('server_error', (error) => {
            this.handleServerError(error);
        });
        
        this.client.on('connection_error', (error) => {
            this.handleConnectionError(error);
        });
        
        // Global error handler
        window.addEventListener('unhandledrejection', (event) => {
            if (event.reason && event.reason.message) {
                console.error('Unhandled promise rejection:', event.reason);
                this.handleGenericError(event.reason);
            }
        });
    }
    
    handleServerError(error) {
        const { code, message, details } = error;
        
        switch (code) {
            case 'UNAUTHORIZED':
                notifications.error('Authentication required. Please login again.');
                // Redirect to login or show auth modal
                break;
            case 'PROJECT_NOT_FOUND':
                notifications.error('Project not found. It may have been deleted.');
                break;
            case 'CLAUDE_SESSION_FAILED':
                notifications.error('Failed to start Claude session. Please try again.');
                break;
            case 'TERMINAL_CREATE_FAILED':
                notifications.error('Failed to create terminal session.');
                break;
            case 'SYSTEM_OVERLOAD':
                notifications.warning('System is overloaded. Please wait and try again.');
                break;
            default:
                notifications.error(message || 'An error occurred on the server.');
        }
    }
    
    handleConnectionError(error) {
        console.error('Connection error:', error);
        
        if (error.message.includes('ECONNREFUSED')) {
            notifications.error('Cannot connect to server. Please check if the server is running.');
        } else if (error.message.includes('timeout')) {
            notifications.warning('Connection timeout. Please check your internet connection.');
        } else {
            notifications.error('Connection error occurred. Trying to reconnect...');
        }
    }
    
    handleGenericError(error) {
        console.error('Generic error:', error);
        // Only show notification for critical errors
        if (error.message.includes('socket') || error.message.includes('connection')) {
            notifications.error('A connection error occurred.');
        }
    }
}

// Heartbeat monitor to ensure connection health
class ConnectionMonitor {
    constructor(socketClient) {
        this.client = socketClient;
        this.heartbeatInterval = null;
        this.lastPong = Date.now();
        this.pingTimeout = 120000; // 120 seconds - increased timeout
        
        this.setupMonitoring();
    }
    
    setupMonitoring() {
        this.client.on('connected', () => {
            this.startHeartbeat();
        });
        
        this.client.on('disconnected', () => {
            this.stopHeartbeat();
        });
        
        // Listen for pong responses
        this.client.getSocket().on('pong', () => {
            this.lastPong = Date.now();
        });
    }
    
    startHeartbeat() {
        this.stopHeartbeat(); // Clear any existing interval
        
        this.heartbeatInterval = setInterval(() => {
            const now = Date.now();
            const timeSinceLastPong = now - this.lastPong;
            
            if (timeSinceLastPong > this.pingTimeout) {
                console.warn('🏓 Heartbeat timeout detected, attempting reconnection');
                // Store current project before reconnecting
                const currentProject = this.client.getCurrentProject();
                this.client.disconnect();
                setTimeout(() => {
                    this.client.connect();
                    // Rejoin project after reconnection
                    if (currentProject) {
                        setTimeout(() => {
                            this.client.joinProject(currentProject);
                        }, 1000);
                    }
                }, 1000);
            } else {
                // Send ping
                this.client.getSocket().emit('ping');
            }
        }, 60000); // Check every 60 seconds - less frequent checks
    }
    
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
}

// Initialize socket client
const socketClient = new SocketClient();
const socketErrorHandler = new SocketErrorHandler(socketClient);
const connectionMonitor = new ConnectionMonitor(socketClient);

// Make socket client globally available
window.socket = socketClient;

// Export for other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SocketClient, SocketErrorHandler, ConnectionMonitor };
}