<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Peer } from 'peerjs';

const localVideo = ref(null);
const remoteVideos = ref([]);
const roomId = ref('');
const isHost = ref(false);
const isCameraOn = ref(true);
const isMicOn = ref(true);
const localStream = ref(null);
const peer = ref(null);
const connections = ref(new Map());
const participants = ref([]);
const hasJoinedRoom = ref(false);
const isConnecting = ref(false);
const copySuccess = ref(false);

onMounted(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get('roomId');
  if (roomIdFromUrl) {
    roomId.value = roomIdFromUrl;
    joinRoom();
  }
});

const copyRoomLink = async () => {
  const url = new URL(window.location.href);
  url.searchParams.set('roomId', roomId.value);
  try {
    await navigator.clipboard.writeText(url.toString());
    copySuccess.value = true;
    setTimeout(() => {
      copySuccess.value = false;
    }, 2000);
  } catch (err) {
    console.error('复制链接失败:', err);
  }
};

const createRoom = async () => {
  isHost.value = true;
  isConnecting.value = true;
  try {
    await initializeMedia();
    initializePeer();
    hasJoinedRoom.value = true;
  } catch (error) {
    console.error('创建房间失败:', error);
    isConnecting.value = false;
  }
};

const joinRoom = async () => {
  if (!roomId.value) {
    console.error('请输入有效的房间号');
    return;
  }
  isConnecting.value = true;
  try {
    console.log('正在尝试加入房间:', roomId.value);
    await initializeMedia();
    console.log('媒体设备初始化成功，正在建立P2P连接...');
    initializePeer();
    hasJoinedRoom.value = true;
  } catch (error) {
    console.error('加入房间失败:', error);
    isConnecting.value = false;
  }
};

const initializeMedia = async () => {
  try {
    localStream.value = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    if (localVideo.value) {
      localVideo.value.srcObject = localStream.value;
      await new Promise((resolve, reject) => {
        localVideo.value.onloadedmetadata = () => {
          localVideo.value
            .play()
            .then(resolve)
            .catch(error => {
              console.error('播放本地视频失败:', error);
              reject(error);
            });
        };
        localVideo.value.onerror = error => {
          console.error('视频元素加载失败:', error);
          reject(error);
        };
      });
    } else {
      throw new Error('未找到本地视频元素');
    }
  } catch (err) {
    console.error('获取或设置媒体设备失败:', err);
    throw err;
  }
};

const handleCall = call => {
  console.log('收到新的通话请求，来自:', call.peer);
  call.on('stream', async stream => {
    console.log('收到远程媒体流');
    const existingVideo = remoteVideos.value.find(v => v.id === call.peer);
    const existingParticipant = participants.value.find(p => p.id === call.peer);

    const videoObj = {
      id: call.peer,
      stream: stream,
      isMuted: false,
      connectionStatus: '已连接',
    };

    // 更新或添加远程视频流
    if (existingVideo) {
      Object.assign(existingVideo, videoObj);
    } else {
      console.log('添加新的远程视频流:', call.peer);
      remoteVideos.value.push(videoObj);
      // 立即设置视频流
      setTimeout(() => {
        const videos = document.querySelectorAll('.remote-video video');
        videos.forEach(video => {
          if (!video.srcObject) {
            video.srcObject = stream;
            video.play().catch(e => console.error('播放远程视频失败:', e));
          }
        });
      }, 100);

      if (!existingParticipant) {
        console.log('添加新的参与者:', call.peer);
        participants.value.push({
          id: call.peer,
          isMuted: false,
          connectionStatus: '已连接',
        });
      }

      // 确保远程视频和音频都能正常播放
      await new Promise(resolve => setTimeout(resolve, 100));
      const videos = document.querySelectorAll('.remote-video video');
      videos.forEach(async video => {
        if (video.srcObject === stream) {
          try {
            await video.play();
            console.log('远程视频开始播放:', call.peer);
          } catch (e) {
            console.error('播放远程视频失败:', e);
          }
        }
      });
    }
  });

  call.on('close', () => {
    console.log('远程用户断开连接:', call.peer);
    remoteVideos.value = remoteVideos.value.filter(video => video.id !== call.peer);
    participants.value = participants.value.filter(p => p.id !== call.peer);
  });

  call.on('error', error => {
    console.error('处理通话时发生错误:', error);
  });

  connections.value.set(call.peer, call);
  console.log('已建立新的连接:', call.peer);
};

const initializePeer = () => {
  peer.value = new Peer();

  peer.value.on('open', id => {
    console.log('已连接到 PeerJS 服务器，我的 ID:', id);
    if (isHost.value) {
      console.log('房主模式：等待其他用户加入...');
      roomId.value = id; // 将房主的 peer ID 设置为房间号
    } else {
      console.log('访客模式：尝试连接到房主:', roomId.value);
      // 确保在访客模式下立即尝试连接到房主
      connectToPeer(roomId.value);
    }
  });

  peer.value.on('call', call => {
    console.log('收到新的连接请求，来自:', call.peer);
    if (localStream.value) {
      console.log('正在接受连接请求并发送媒体流...');
      call.answer(localStream.value);
      handleCall(call);
    } else {
      console.error('本地媒体流未初始化，无法接受连接请求');
    }
  });

  peer.value.on('error', error => {
    console.error('PeerJS 错误:', error);
    const peerId = error.peer;
    if (peerId) {
      const participant = participants.value.find(p => p.id === peerId);
      if (participant) {
        participant.connectionStatus = '连接错误';
        console.log('参与者连接状态更新为错误:', peerId);
      }
    }
  });

  peer.value.on('disconnected', () => {
    console.log('与 PeerJS 服务器断开连接');
  });

  peer.value.on('close', () => {
    console.log('PeerJS 连接已关闭');
  });
};

const connectToPeer = peerId => {
  console.log('正在连接到对方:', peerId);
  if (!localStream.value) {
    console.error('本地媒体流未初始化');
    return;
  }

  if (!peer.value) {
    console.error('PeerJS 实例未初始化');
    return;
  }

  try {
    console.log('正在创建到对方的通话连接...');
    const call = peer.value.call(peerId, localStream.value);
    if (!call) {
      console.error('创建通话失败，无法建立连接');
      return;
    }
    console.log('已发起通话请求，等待对方响应...');

    call.on('stream', stream => {
      console.log('成功收到对方的媒体流，开始处理...');
      handleCall(call);
    });

    call.on('error', error => {
      console.error('通话过程中发生错误:', error);
      const errorMessage = error.type === 'peer-unavailable' ? '无法连接到指定房间，请确认房间号是否正确' : '连接过程中发生错误';
      console.error(errorMessage);
    });

    call.on('close', () => {
      console.log('通话已结束，清理相关资源...');
      remoteVideos.value = remoteVideos.value.filter(video => video.id !== call.peer);
      participants.value = participants.value.filter(p => p.id !== call.peer);
    });
  } catch (error) {
    console.error('尝试建立连接时发生错误:', error);
  }
};

const toggleCamera = async () => {
  try {
    if (!localStream.value) {
      localStream.value = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
    } else if (!localStream.value.getVideoTracks().length) {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const videoTrack = videoStream.getVideoTracks()[0];
      localStream.value.addTrack(videoTrack);
    }

    const videoTrack = localStream.value.getVideoTracks()[0];
    if (videoTrack) {
      isCameraOn.value = !isCameraOn.value;
      videoTrack.enabled = isCameraOn.value;

      if (localVideo.value) {
        localVideo.value.srcObject = localStream.value;
        await localVideo.value.play();
      }
    }
  } catch (error) {
    console.error('摄像头初始化失败:', error);
    isCameraOn.value = false;
  }
};

const toggleMic = () => {
  if (localStream.value) {
    const audioTrack = localStream.value.getAudioTracks()[0];
    if (audioTrack) {
      isMicOn.value = !isMicOn.value;
      audioTrack.enabled = isMicOn.value;
    }
  }
};

const toggleParticipantAudio = participantId => {
  if (!isHost.value) return;
  const participant = participants.value.find(p => p.id === participantId);
  if (participant) {
    participant.isMuted = !participant.isMuted;
    const remoteVideo = remoteVideos.value.find(v => v.id === participantId);
    if (remoteVideo && remoteVideo.stream) {
      const audioTrack = remoteVideo.stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !participant.isMuted;
      }
    }
  }
};

onMounted(async () => {
  try {
    await initializeMedia();
  } catch (err) {
    console.error('初始化媒体设备失败:', err);
  }
});

onUnmounted(() => {
  if (localStream.value) {
    localStream.value.getTracks().forEach(track => track.stop());
  }
  connections.value.forEach(connection => connection.close());
  if (peer.value) {
    peer.value.destroy();
  }
});
</script>

<template>
  <div class="video-chat">
    <div v-if="!hasJoinedRoom" class="join-controls">
      <button @click="createRoom">创建房间</button>
      <div class="join-form">
        <input v-model="roomId" placeholder="输入房间号" />
        <button @click="joinRoom">加入房间</button>
      </div>
    </div>

    <div v-if="isConnecting && !peer" class="connecting-status">
      <h2>正在连接中...</h2>
    </div>

    <div v-else-if="hasJoinedRoom" class="room-info">
      <div class="room-header">
        <h2>房间号: {{ roomId }}</h2>
        <button @click="copyRoomLink" :class="{ 'copy-success': copySuccess }">
          {{ copySuccess ? '复制成功' : '复制链接' }}
        </button>
      </div>
      <div class="controls">
        <button @click="toggleCamera">
          {{ isCameraOn ? '关闭摄像头' : '开启摄像头' }}
        </button>
        <button @click="toggleMic">
          {{ isMicOn ? '关闭麦克风' : '开启麦克风' }}
        </button>
      </div>
    </div>

    <div class="participants-list">
      <h3>参与者列表</h3>
      <div v-for="participant in participants" :key="participant.id" class="participant-item">
        <span class="participant-info">
          <span class="participant-id">用户 {{ participant.id.slice(0, 6) }}</span>
          <span class="connection-status" :class="participant.connectionStatus === '已连接' ? 'connected' : 'error'">
            {{ participant.connectionStatus }}
          </span>
        </span>
        <button v-if="isHost" @click="toggleParticipantAudio(participant.id)" :class="{ muted: participant.isMuted }">
          {{ participant.isMuted ? '取消静音' : '静音' }}
        </button>
      </div>
    </div>

    <div class="videos-container">
      <div class="local-video">
        <video ref="localVideo" autoplay playsInline muted style="transform: scaleX(-1)"></video>
        <div class="video-label">我 ({{ isMicOn ? '麦克风开启' : '麦克风关闭' }})</div>
      </div>
      <div class="remote-videos">
        <div v-for="video in remoteVideos" :key="video.id" class="remote-video">
          <video
            :ref="
              el => {
                if (el) el.srcObject = video.stream;
              }
            "
            autoplay
            playsinline
            style="transform: scaleX(-1)"
          ></video>
          <div class="video-label">用户 {{ video.id.slice(0, 6) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.video-chat {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.join-controls {
  display: flex;
  flex-direction: column;
  gap: 20px;
  align-items: center;
  margin-bottom: 20px;
}

.join-form {
  display: flex;
  gap: 10px;
}

.room-info {
  text-align: center;
  margin-bottom: 20px;
}

.room-header {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
}

.connecting-status {
  text-align: center;
  margin: 20px 0;
  color: #646cff;
}

.copy-success {
  background-color: #4caf50 !important;
}

.controls {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 10px 0;
}

.videos-container {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  margin-bottom: 20px;
}

.local-video,
.remote-video {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
  background: #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.video-label {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 14px;
}

video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: brightness(1.1) contrast(1.1);
}

button {
  padding: 8px 16px;
  border-radius: 4px;
  border: none;
  background: #646cff;
  color: white;
  cursor: pointer;
}

button:hover {
  background: #535bf2;
}

button.muted {
  background: #ff4646;
}

button.muted:hover {
  background: #f23535;
}

input {
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.participants-list {
  margin-top: 20px;
  border-top: 1px solid #eee;
  padding-top: 20px;
}

.participants-list h3 {
  margin-bottom: 15px;
  color: #333;
}

.participant-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  background: #f5f5f5;
  border-radius: 4px;
  margin-bottom: 8px;
}

.participant-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.participant-id {
  font-weight: 500;
}

.connection-status {
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
}

.connection-status.connected {
  background: #4caf50;
  color: white;
}

.connection-status.error {
  background: #f44336;
  color: white;
}
</style>
