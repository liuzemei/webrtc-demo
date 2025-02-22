import MediaManager from './MediaManager';
import ConnectionManager from './ConnectionManager';

class WebRTCService {
  constructor() {
    this.mediaManager = new MediaManager();
    this.connectionManager = new ConnectionManager();
    this.setupEventListeners();
  }

  setupEventListeners() {
    // 监听本地流就绪事件
    this.mediaManager.on('localStreamReady', stream => {
      // 设置本地流到连接管理器
      this.connectionManager.setLocalStream(stream);
      // 转发本地流就绪事件给组件
      this.connectionManager.emit('localStreamReady', stream);
    });
  }

  on(event, callback) {
    if (event.startsWith('media')) {
      this.mediaManager.on(event, callback);
    } else {
      this.connectionManager.on(event, callback);
    }
  }

  off(event, callback) {
    if (event.startsWith('media')) {
      this.mediaManager.off(event, callback);
    } else {
      this.connectionManager.off(event, callback);
    }
  }

  async createRoom() {
    this.connectionManager.isHost = true;
    try {
      await this.mediaManager.initializeMedia();
      await this.connectionManager.initializePeer();
      return true;
    } catch (error) {
      console.error('创建房间失败:', error);
      throw error;
    }
  }

  async joinRoom(roomId) {
    if (!roomId) {
      throw new Error('请输入有效的房间号');
    }
    this.connectionManager.roomId = roomId;
    try {
      await this.mediaManager.initializeMedia();
      await this.connectionManager.initializePeer();
      return true;
    } catch (error) {
      console.error('加入房间失败:', error);
      throw error;
    }
  }

  async toggleCamera() {
    return this.mediaManager.toggleCamera();
  }

  toggleMic() {
    return this.mediaManager.toggleMic();
  }

  toggleParticipantAudio(participantId) {
    const connection = this.connectionManager.connections.get(participantId);
    if (connection) {
      return this.mediaManager.toggleParticipantAudio(connection.remoteStream);
    }
    return false;
  }

  cleanup() {
    this.mediaManager.cleanup();
    this.connectionManager.cleanup();
  }

  destroy() {
    this.cleanup();
    this.mediaManager.clear();
    this.connectionManager.clear();
  }
}

export default WebRTCService;