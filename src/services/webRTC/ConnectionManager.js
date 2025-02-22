import { Peer } from 'peerjs';
import EventEmitter from './EventEmitter';

class ConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.peer = null;
    this.connections = new Map();
    this.connectionStats = new Map();
    this.isHost = false;
    this.roomId = '';
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 5000;
  }

  async initializePeer() {
    return new Promise((resolve, reject) => {
      this.peer = new Peer(this.isHost ? 'eddbe031-dfdc-45bc-bd8a-493c21a8a112' : undefined);

      this.peer.on('open', id => {
        console.log('已连接到 PeerJS 服务器，ID:', id);
        this.reconnectAttempts = 0;
        if (this.isHost) {
          this.roomId = id;
          this.emit('roomCreated', id);
        } else {
          // 连接到房主
          this.connectToPeer(this.roomId);
          // 向房主请求当前房间内的其他参与者列表
          const conn = this.peer.connect(this.roomId);
          conn.on('open', () => {
            conn.send({ type: 'requestPeers' });
          });
        }
        resolve(id);
      });

      // 处理数据连接
      this.peer.on('connection', conn => {
        conn.on('data', data => {
          if (data.type === 'requestPeers') {
            // 如果是房主，发送当前房间内的所有参与者ID
            if (this.isHost) {
              const peers = Array.from(this.connections.keys());
              conn.send({ type: 'peerList', peers });
            }
          } else if (data.type === 'peerList') {
            // 收到参与者列表后，与每个参与者建立连接
            data.peers.forEach(peerId => {
              if (peerId !== this.peer.id && !this.connections.has(peerId)) {
                this.connectToPeer(peerId);
              }
            });
          }
        });
      });

      this.peer.on('call', call => {
        this.handleCall(call);
      });

      this.peer.on('error', error => {
        console.error('PeerJS 错误:', error);
        this.emit('peerError', { error, peerId: error.peer });
        this.startReconnection();
        reject(error);
      });

      this.peer.on('disconnected', () => {
        this.emit('disconnected');
        this.startReconnection();
      });

      this.peer.on('close', () => {
        this.emit('closed');
        this.cleanup();
      });
    });
  }

  handleCall(call) {
    if (this.localStream) {
      call.answer(this.localStream);
    }

    call.on('stream', stream => {
      this.emit('remoteStream', { peerId: call.peer, stream });
      if (call.peerConnection) {
        this.monitorConnectionStats(call.peer, call.peerConnection);
      }

      stream.getTracks().forEach(track => {
        track.onended = () => {
          console.log(`远程用户 ${call.peer} 的${track.kind}轨道已结束`);
          const allTracksEnded = stream.getTracks().every(t => t.readyState === 'ended');
          if (allTracksEnded) {
            this.handlePeerDisconnection(call.peer, stream);
          }
        };
      });
    });

    call.on('close', () => {
      this.handlePeerDisconnection(call.peer, call.remoteStream);
    });

    call.on('error', error => {
      console.error('处理通话时发生错误:', error);
      this.emit('callError', { error, peerId: call.peer });
    });

    this.connections.set(call.peer, call);
  }

  handlePeerDisconnection(peerId, stream) {
    console.log(`远程用户 ${peerId} 断开连接，正在清理资源`);
    this.emit('peerDisconnected', peerId);
    this.connections.delete(peerId);
    if (stream) {
      stream.getTracks().forEach(track => {
        console.log(`停止远程用户 ${peerId} 的 ${track.kind} 轨道`);
        track.stop();
      });
    }
  }

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

  startReconnection() {
    if (this.reconnectTimer) {
      return;
    }

    this.emit('reconnecting', { attempt: this.reconnectAttempts + 1, max: this.maxReconnectAttempts });

    this.reconnectTimer = setInterval(async () => {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.log('达到最大重连次数，停止重连');
        this.stopReconnection();
        this.emit('reconnectFailed');
        this.cleanup();
        return;
      }

      this.reconnectAttempts++;
      console.log(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      try {
        if (this.peer) {
          this.peer.destroy();
          this.peer = null;
        }

        await this.initializePeer();
        if (this.roomId && !this.isHost) {
          await this.connectToPeer(this.roomId);
        }

        this.stopReconnection();
        this.emit('reconnected');
      } catch (error) {
        console.error('重连失败:', error);
        this.emit('reconnectError', { error, attempt: this.reconnectAttempts });
      }
    }, this.reconnectInterval);
  }

  stopReconnection() {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  cleanup() {
    this.stopReconnection();
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

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    this.isHost = false;
    this.roomId = '';
    this.emit('cleanup', null);
  }

  setLocalStream(stream) {
    this.localStream = stream;
  }
}

export default ConnectionManager;
