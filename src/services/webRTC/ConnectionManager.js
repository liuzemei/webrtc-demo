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
      this.peer = new Peer();

      this.peer.on('open', id => {
        console.log('已连接到 PeerJS 服务器，ID:', id);
        this.reconnectAttempts = 0;
        if (this.isHost) {
          this.roomId = id;
          this.emit('roomCreated', id);
        } else {
          console.log(`非房主用户尝试加入房间: ${this.roomId}`);
          // 连接到房主
          const conn = this.peer.connect(this.roomId);
          conn.on('open', () => {
            console.log(`与房主建立数据连接成功，请求参与者列表`);
            conn.send({ type: 'requestPeers' });
            // 保存与房主的连接
            this.connections.set(this.roomId, { dataConnection: conn });
          });

          conn.on('error', error => {
            console.error(`与房主建立连接时发生错误:`, error);
            reject(error);
          });

          conn.on('data', async data => {
            console.log(`收到来自房主的数据:`, data);
            if (data.type === 'peerList') {
              // 收到参与者列表后，与每个参与者建立连接
              console.log(`收到房主发送的参与者列表:`, data.peers);
              data.peers.forEach(peerId => {
                if (peerId !== this.peer.id && !this.connections.has(peerId)) {
                  console.log(`准备与参与者 ${peerId} 建立连接`);
                  const dataConn = this.peer.connect(peerId);
                  dataConn.on('open', () => {
                    console.log(`与参与者 ${peerId} 的数据连接已建立`);
                    if (!this.connections.has(peerId)) {
                      this.connections.set(peerId, { dataConnection: dataConn });
                    } else {
                      this.connections.get(peerId).dataConnection = dataConn;
                    }
                    if (this.localStream) {
                      console.log(`准备与参与者 ${peerId} 建立媒体连接`);
                      this.connectToPeer(peerId);
                    }
                  });
                }
              });
            } else if (data.type === 'newPeer') {
              // 收到新参与者通知，建立连接
              console.log(`收到新参与者 ${data.peerId} 加入的通知`);
              if (data.peerId !== this.peer.id && !this.connections.has(data.peerId)) {
                console.log(`准备与新参与者 ${data.peerId} 建立连接`);
                const dataConn = this.peer.connect(data.peerId);
                dataConn.on('open', () => {
                  console.log(`与新参与者 ${data.peerId} 的数据连接已建立`);
                  if (!this.connections.has(data.peerId)) {
                    this.connections.set(data.peerId, { dataConnection: dataConn });
                  } else {
                    this.connections.get(data.peerId).dataConnection = dataConn;
                  }
                  if (this.localStream) {
                    console.log(`准备与新参与者 ${data.peerId} 建立媒体连接`);
                    this.connectToPeer(data.peerId);
                  }
                });
              }
            }
          });
        }
        resolve(id);
      });

      // 处理数据连接
      this.peer.on('connection', conn => {
        const peerId = conn.peer;
        console.log(`收到来自 ${peerId} 的连接请求`);

        // 将连接保存到 connections Map 中
        if (!this.connections.has(peerId)) {
          console.log(`新参与者 ${peerId} 加入房间`);
          this.connections.set(peerId, { dataConnection: conn });

          // 如果是房主，立即通知其他参与者有新成员加入
          if (this.isHost) {
            console.log(`房主正在通知其他参与者新成员 ${peerId} 的加入`);
            this.connections.forEach((connection, existingPeerId) => {
              if (existingPeerId !== peerId && connection.dataConnection) {
                console.log(`通知参与者 ${existingPeerId} 新成员 ${peerId} 的加入`);
                connection.dataConnection.send({ type: 'newPeer', peerId: peerId });
              }
            });
          }
        } else {
          console.log(`更新与 ${peerId} 的数据连接`);
          this.connections.get(peerId).dataConnection = conn;
        }

        conn.on('data', async data => {
          console.log(`收到来自 ${peerId} 的数据:`, data);
          if (data.type === 'requestPeers') {
            // 如果是房主，发送当前房间内的所有参与者ID
            if (this.isHost) {
              const peers = Array.from(this.connections.keys());
              console.log(`房主发送参与者列表给 ${peerId}:`, peers);

              // 通知所有现有参与者有新成员加入
              this.connections.forEach((connection, existingPeerId) => {
                if (existingPeerId !== peerId && connection.dataConnection) {
                  console.log(`通知参与者 ${existingPeerId} 新成员 ${peerId} 的加入`);
                  connection.dataConnection.send({ type: 'newPeer', peerId: peerId });
                }
              });

              // 主动与新加入的参与者建立媒体连接
              if (this.localStream) {
                console.log(`房主主动与新参与者 ${peerId} 建立媒体连接`);
                this.connectToPeer(peerId);
              }

              // 添加短暂延迟
              console.log(`等待数据连接稳定后发送参与者列表给 ${peerId}`);
              await new Promise(resolve => setTimeout(resolve, 5000));

              // 添加消息发送重试机制
              const maxRetries = 3;
              let retryCount = 0;
              const sendPeerList = async () => {
                try {
                  const peers = Array.from(this.connections.keys());
                  await conn.send({ type: 'peerList', peers });
                  console.log(`成功发送参与者列表给 ${peerId}`);
                } catch (error) {
                  console.error(`发送参与者列表给 ${peerId} 失败:`, error);
                  if (retryCount < maxRetries) {
                    retryCount++;
                    console.log(`尝试第 ${retryCount} 次重新发送参与者列表给 ${peerId}`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await sendPeerList();
                  } else {
                    console.error(`发送参与者列表给 ${peerId} 失败，已达到最大重试次数`);
                    this.emit('peerError', { error: new Error('发送参与者列表失败'), peerId });
                  }
                }
              };

              await sendPeerList();
              // 删除冗余的发送操作
              try {
                const res = await conn.send({ type: 'peerList', peers });
                console.log(`已发送参与者列表给 ${peerId}`, res);
              } catch (e) {}
            }
          } else if (data.type === 'peerList') {
            // 收到参与者列表后，与每个参与者建立连接
            console.log(`收到房主发送的参与者列表:`, data.peers);
            data.peers.forEach(peerId => {
              if (peerId !== this.peer.id && !this.connections.has(peerId)) {
                console.log(`准备与参与者 ${peerId} 建立连接`);
                const dataConn = this.peer.connect(peerId);
                dataConn.on('open', () => {
                  console.log(`与参与者 ${peerId} 的数据连接已建立`);
                  if (!this.connections.has(peerId)) {
                    this.connections.set(peerId, { dataConnection: dataConn });
                  } else {
                    this.connections.get(peerId).dataConnection = dataConn;
                  }
                  if (this.localStream) {
                    console.log(`准备与参与者 ${peerId} 建立媒体连接`);
                    this.connectToPeer(peerId);
                  }
                });
              }
            });
          } else if (data.type === 'newPeer') {
            // 收到新参与者通知，建立连接
            console.log(`收到新参与者 ${data.peerId} 加入的通知`);
            if (data.peerId !== this.peer.id && !this.connections.has(data.peerId)) {
              console.log(`准备与新参与者 ${data.peerId} 建立连接`);
              const dataConn = this.peer.connect(data.peerId);
              dataConn.on('open', () => {
                console.log(`与新参与者 ${data.peerId} 的数据连接已建立`);
                if (!this.connections.has(data.peerId)) {
                  this.connections.set(data.peerId, { dataConnection: dataConn });
                } else {
                  this.connections.get(data.peerId).dataConnection = dataConn;
                }
                if (this.localStream) {
                  console.log(`准备与新参与者 ${data.peerId} 建立媒体连接`);
                  this.connectToPeer(data.peerId);
                }
              });
            }
          }
        });

        conn.on('close', () => {
          console.log(`与 ${peerId} 的数据连接已关闭`);
        });

        conn.on('error', error => {
          console.error(`与 ${peerId} 的数据连接发生错误:`, error);
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
    console.log(`处理来自 ${call.peer} 的通话请求`);
    if (this.localStream) {
      console.log(`使用本地流回应通话请求`);
      call.answer(this.localStream);
    } else {
      console.warn(`没有本地流可用，将以无媒体流方式回应`);
      call.answer();
    }

    call.on('stream', stream => {
      console.log(`收到来自 ${call.peer} 的媒体流`);
      this.emit('remoteStream', { peerId: call.peer, stream });
      if (call.peerConnection) {
        console.log(`开始监控与 ${call.peer} 的连接质量`);
        this.monitorConnectionStats(call.peer, call.peerConnection);
      }

      stream.getTracks().forEach(track => {
        console.log(`监听来自 ${call.peer} 的 ${track.kind} 轨道状态`);
        track.onended = () => {
          console.log(`远程用户 ${call.peer} 的 ${track.kind} 轨道已结束`);
          const allTracksEnded = stream.getTracks().every(t => t.readyState === 'ended');
          if (allTracksEnded) {
            console.log(`远程用户 ${call.peer} 的所有轨道已结束，处理断开连接`);
            this.handlePeerDisconnection(call.peer, stream);
          }
        };
      });
    });

    call.on('close', () => {
      console.log(`与 ${call.peer} 的通话已关闭`);
      this.handlePeerDisconnection(call.peer, call.remoteStream);
    });

    call.on('error', error => {
      console.error(`处理与 ${call.peer} 的通话时发生错误:`, error);
      this.emit('callError', { error, peerId: call.peer });
    });

    if (!this.connections.has(call.peer)) {
      console.log(`将与 ${call.peer} 的连接保存到连接列表`);
      this.connections.set(call.peer, { mediaConnection: call });
    } else {
      console.log(`更新与 ${call.peer} 的媒体连接`);
      this.connections.get(call.peer).mediaConnection = call;
    }
  }

  monitorConnectionStats(peerId, peerConnection) {
    const statsInterval = setInterval(async () => {
      if (!peerConnection || peerConnection.connectionState === 'closed') {
        clearInterval(statsInterval);
        return;
      }

      try {
        const stats = await peerConnection.getStats();
        let rtt = 0;
        let packetsLost = 0;
        let packetsReceived = 0;
        let bytesReceived = 0;

        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = report.currentRoundTripTime * 1000; // 转换为毫秒
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            packetsLost = report.packetsLost;
            packetsReceived = report.packetsReceived;
            bytesReceived = report.bytesReceived;
          }
        });

        const packetLossRate = packetsReceived > 0 ? (packetsLost / (packetsLost + packetsReceived)) * 100 : 0;
        const signalStrength = Math.max(0, 100 - rtt / 10); // 简单的信号强度计算

        this.connectionStats.set(peerId, {
          rtt,
          packetLossRate,
          signalStrength,
          bytesReceived,
        });

        this.emit('connectionStats', {
          peerId,
          quality: {
            rtt,
            packetLossRate,
            signalStrength,
          },
        });

        // 如果连接质量太差，触发警告
        if (packetLossRate > 15 || rtt > 1000) {
          this.emit('poorConnection', { peerId, rtt, packetLossRate });
        }
      } catch (error) {
        console.error(`获取连接统计信息失败: ${error}`);
      }
    }, 2000); // 每2秒更新一次统计信息

    // 监听 ICE 连接状态变化
    peerConnection.oniceconnectionstatechange = () => {
      console.log(`ICE 连接状态变化: ${peerConnection.iceConnectionState}`);
      if (peerConnection.iceConnectionState === 'failed') {
        this.emit('iceConnectionFailed', { peerId });
        this.handlePeerDisconnection(peerId);
      }
    };

    // 监听连接状态变化
    peerConnection.onconnectionstatechange = () => {
      console.log(`连接状态变化: ${peerConnection.connectionState}`);
      if (peerConnection.connectionState === 'failed') {
        this.emit('connectionFailed', { peerId });
        this.handlePeerDisconnection(peerId);
      }
    };
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
      console.error('尝试建立连接时发现未初始化的状态');
      throw new Error('未初始化');
    }

    console.log(`正在与 ${peerId} 建立媒体连接`);
    const call = this.peer.call(peerId, this.localStream);
    if (!call) {
      console.error(`与 ${peerId} 创建通话失败`);
      throw new Error('创建通话失败');
    }

    console.log(`成功创建与 ${peerId} 的通话，等待对方响应`);
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
