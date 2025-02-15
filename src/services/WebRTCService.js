import { Peer } from 'peerjs';

class WebRTCService {
  constructor() {
    this.peer = null;
    this.localStream = null;
    this.connections = new Map();
    this.listeners = new Map();
    this.connectionStats = new Map();
    this.isHost = false;
    this.roomId = '';
  }

  // 事件监听相关方法
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }

  // 初始化媒体设备
  async initializeMedia() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      this.emit('localStreamReady', this.localStream);
      return this.localStream;
    } catch (err) {
      console.error('获取或设置媒体设备失败:', err);
      throw err;
    }
  }

  // 创建房间
  async createRoom() {
    this.isHost = true;
    try {
      await this.initializeMedia();
      await this.initializePeer();
      return true;
    } catch (error) {
      console.error('创建房间失败:', error);
      throw error;
    }
  }

  // 加入房间
  async joinRoom(roomId) {
    if (!roomId) {
      throw new Error('请输入有效的房间号');
    }
    this.roomId = roomId;
    try {
      await this.initializeMedia();
      await this.initializePeer();
      return true;
    } catch (error) {
      console.error('加入房间失败:', error);
      throw error;
    }
  }

  // 初始化 Peer 连接
  async initializePeer() {
    return new Promise((resolve, reject) => {
      this.peer = new Peer();

      this.peer.on('open', id => {
        console.log('已连接到 PeerJS 服务器，ID:', id);
        if (this.isHost) {
          this.roomId = id;
          this.emit('roomCreated', id);
        } else {
          this.connectToPeer(this.roomId);
        }
        resolve(id);
      });

      this.peer.on('call', call => {
        if (this.localStream) {
          call.answer(this.localStream);
          this.handleCall(call);
        }
      });

      this.peer.on('error', error => {
        console.error('PeerJS 错误:', error);
        this.emit('peerError', { error, peerId: error.peer });
        reject(error);
      });

      this.peer.on('disconnected', () => {
        this.emit('disconnected');
        this.cleanup();
      });

      this.peer.on('close', () => {
        this.emit('closed');
        this.cleanup();
      });
    });
  }

  // 处理通话连接
  handleCall(call) {
    call.on('stream', stream => {
      this.emit('remoteStream', { peerId: call.peer, stream });
      if (call.peerConnection) {
        this.monitorConnectionStats(call.peer, call.peerConnection);
      }

      // 监听音视频轨道结束事件
      stream.getTracks().forEach(track => {
        track.onended = () => {
          console.log(`远程用户 ${call.peer} 的${track.kind}轨道已结束`);
          // 检查是否所有轨道都已结束
          const allTracksEnded = stream.getTracks().every(t => t.readyState === 'ended');
          if (allTracksEnded) {
            console.log(`远程用户 ${call.peer} 的所有媒体轨道已结束，准备清理资源`);
            this.emit('peerDisconnected', call.peer);
            this.connections.delete(call.peer);
            stream.getTracks().forEach(t => t.stop());
          }
        };
      });
    });

    call.on('close', () => {
      console.log(`远程用户 ${call.peer} 断开连接，正在清理资源`);
      this.emit('peerDisconnected', call.peer);
      this.connections.delete(call.peer);
      // 确保停止所有轨道
      if (call.remoteStream) {
        call.remoteStream.getTracks().forEach(track => {
          console.log(`停止远程用户 ${call.peer} 的 ${track.kind} 轨道`);
          track.stop();
        });
      }
    });

    call.on('error', error => {
      console.error('处理通话时发生错误:', error);
      this.emit('callError', { error, peerId: call.peer });
    });

    this.connections.set(call.peer, call);
  }

  // 连接到对等端
  connectToPeer(peerId) {
    if (!this.localStream || !this.peer) {
      throw new Error('未初始化');
    }

    const call = this.peer.call(peerId, this.localStream);
    if (!call) {
      throw new Error('创建通话失败');
    }

    this.handleCall(call);
  }

  // 监控连接状态
  monitorConnectionStats(peerId, peerConnection) {
    let lastStatsTime = 0;
    let isConnectionActive = true;

    // 监听连接状态变化
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      console.log(`连接状态变化 - 用户: ${peerId}, 状态: ${state}`);

      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        isConnectionActive = false;
        this.emit('peerDisconnected', peerId);
        this.connections.delete(peerId);
        this.connectionStats.delete(peerId);
      }
    };

    // 监听ICE连接状态变化
    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      console.log(`ICE连接状态变化 - 用户: ${peerId}, 状态: ${state}`);

      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        isConnectionActive = false;
        this.emit('peerDisconnected', peerId);
        this.connections.delete(peerId);
        this.connectionStats.delete(peerId);
      }
    };

    const statsInterval = setInterval(async () => {
      // 如果连接已断开，停止统计
      if (!isConnectionActive) {
        clearInterval(statsInterval);
        return;
      }

      try {
        const now = Date.now();
        // 限制统计数据采集的最小间隔为2秒
        if (now - lastStatsTime < 2000) {
          return;
        }
        lastStatsTime = now;

        // 检查连接状态
        if (
          peerConnection.connectionState === 'disconnected' ||
          peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'closed' ||
          peerConnection.iceConnectionState === 'disconnected' ||
          peerConnection.iceConnectionState === 'failed' ||
          peerConnection.iceConnectionState === 'closed'
        ) {
          isConnectionActive = false;
          clearInterval(statsInterval);
          this.emit('peerDisconnected', peerId);
          this.connections.delete(peerId);
          this.connectionStats.delete(peerId);
          return;
        }

        const stats = await peerConnection.getStats();
        let rtt = 0;
        let packetsLost = 0;
        let totalPackets = 0;
        let signalStrength = 0;

        for (const report of stats.values()) {
          if (report.type === 'remote-inbound-rtp') {
            rtt = report.roundTripTime * 1000;
            packetsLost = report.packetsLost;
            totalPackets = report.packetsReceived + packetsLost;
            break;
          } else if (report.type === 'inbound-rtp' && (!rtt || !packetsLost)) {
            if (!rtt && report.roundTripTime) {
              rtt = report.roundTripTime * 1000;
            }
            if (!packetsLost) {
              packetsLost = report.packetsLost || 0;
              totalPackets = report.packetsReceived + packetsLost;
            }
          } else if (report.type === 'track' && report.kind === 'video') {
            const frameRate = report.framesPerSecond || 0;
            signalStrength = Math.round((frameRate / 30) * 100);
            break;
          }
        }

        const quality = {
          rtt: Math.round(rtt),
          packetLossRate: totalPackets > 0 ? Math.round((packetsLost / totalPackets) * 100) : 0,
          signalStrength: Math.round(signalStrength),
        };

        const prevQuality = this.connectionStats.get(peerId);
        const hasSignificantChange =
          !prevQuality ||
          Math.abs(quality.rtt - prevQuality.rtt) > 50 ||
          Math.abs(quality.packetLossRate - prevQuality.packetLossRate) > 5 ||
          Math.abs(quality.signalStrength - prevQuality.signalStrength) > 10;

        if (hasSignificantChange) {
          console.log(`连接质量更新 - 用户: ${peerId}`, {
            延迟: `${quality.rtt}ms`,
            丢包率: `${quality.packetLossRate}%`,
            信号强度: `${quality.signalStrength}%`,
          });

          this.connectionStats.set(peerId, quality);
          this.emit('connectionStats', { peerId, quality });
        }
      } catch (error) {
        console.error('获取连接统计信息失败:', error);
        // 如果获取统计信息失败，可能是连接已断开
        isConnectionActive = false;
        clearInterval(statsInterval);
        this.emit('peerDisconnected', peerId);
        this.connections.delete(peerId);
        this.connectionStats.delete(peerId);
      }
    }, 2000);

    return statsInterval;
  }

  // 切换摄像头状态
  async toggleCamera() {
    if (!this.localStream) {
      await this.initializeMedia();
      return true;
    }

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return videoTrack.enabled;
    }
    return false;
  }

  // 切换麦克风状态
  toggleMic() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }

  // 切换参与者音频状态
  toggleParticipantAudio(participantId) {
    const connection = this.connections.get(participantId);
    if (connection && connection.remoteStream) {
      const audioTrack = connection.remoteStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }

  // 清理资源
  cleanup() {
    // 停止并清理本地媒体流
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      this.localStream = null;
    }

    // 关闭并清理所有连接
    this.connections.forEach(connection => {
      if (connection.remoteStream) {
        connection.remoteStream.getTracks().forEach(track => {
          track.stop();
          track.enabled = false;
        });
      }
      connection.close();
    });
    this.connections.clear();
    this.connectionStats.clear();

    // 销毁并重置 Peer 连接
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    // 重置房间状态
    this.isHost = false;
    this.roomId = '';

    // 触发清理完成事件
    this.emit('cleanup', null);
  }

  // 销毁服务
  destroy() {
    this.cleanup();
    this.listeners.clear();
    this.peer = null;
    this.localStream = null;
  }
}

export default WebRTCService;
