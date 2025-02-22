<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import WebRTCService from '../services/webRTC/WebRTCService';

const localVideo = ref(null);
const remoteVideos = ref([]);
const roomId = ref('');
const isHost = ref(false);
const isCameraOn = ref(true);
const isMicOn = ref(true);
const participants = ref([]);
const hasJoinedRoom = ref(false);
const isConnecting = ref(false);
const copySuccess = ref(false);
const webRTC = ref(new WebRTCService());

onMounted(() => {
  // 设置事件监听器
  webRTC.value.on('localStreamReady', stream => {
    if (localVideo.value && stream) {
      localVideo.value.srcObject = stream;
      // 确保视频元素自动播放
      localVideo.value.autoplay = true;
      // 确保视频元素显示
      localVideo.value.style.display = 'block';
      // 尝试播放视频
      localVideo.value.play().catch(e => {
        console.error('播放本地视频失败:', e);
        // 如果自动播放失败，可能需要用户交互
        if (e.name === 'NotAllowedError') {
          console.log('需要用户交互才能播放视频');
        }
      });
    }
  });

  webRTC.value.on('remoteStream', ({ peerId, stream }) => {
    isConnecting.value = false;
    const existingVideo = remoteVideos.value.find(v => v.id === peerId);
    const videoObj = {
      id: peerId,
      stream: stream,
      isMuted: false,
    };

    if (existingVideo) {
      Object.assign(existingVideo, videoObj);
    } else {
      remoteVideos.value.push(videoObj);
      const existingParticipant = participants.value.find(p => p.id === peerId);
      if (!existingParticipant) {
        participants.value.push({
          id: peerId,
          isMuted: false,
          connectionStatus: '已连接',
          connectionQuality: {
            rtt: 0,
            packetLossRate: 0,
            signalStrength: 0,
          },
        });
      }
    }
  });

  webRTC.value.on('peerDisconnected', peerId => {
    remoteVideos.value = remoteVideos.value.filter(video => video.id !== peerId);
    participants.value = participants.value.filter(p => p.id !== peerId);
  });

  webRTC.value.on('connectionStats', ({ peerId, quality }) => {
    const participant = participants.value.find(p => p.id === peerId);
    if (participant) {
      participant.connectionQuality = quality;
    }
  });

  webRTC.value.on('peerError', ({ error, peerId }) => {
    const participant = participants.value.find(p => p.id === peerId);
    if (participant) {
      participant.connectionStatus = '连接错误';
    }
  });

  // 检查 URL 中的房间 ID
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
    // 在创建房间前设置事件监听器
    webRTC.value.on('roomCreated', id => {
      roomId.value = id;
      isConnecting.value = false;
    });

    // 确保在创建新房间前清理旧的资源
    if (webRTC.value) {
      webRTC.value.cleanup();
    }

    await webRTC.value.createRoom();
    hasJoinedRoom.value = true;
  } catch (error) {
    console.error('创建房间失败:', error);
    isConnecting.value = false;
    isHost.value = false;
  }
};

const joinRoom = async () => {
  if (!roomId.value) {
    console.error('请输入有效的房间号');
    return;
  }
  isConnecting.value = true;
  try {
    await webRTC.value.joinRoom(roomId.value);
    hasJoinedRoom.value = true;
  } catch (error) {
    console.error('加入房间失败:', error);
    isConnecting.value = false;
  }
};
const toggleCamera = async () => {
  try {
    const isEnabled = await webRTC.value.toggleCamera();
    isCameraOn.value = isEnabled;
  } catch (error) {
    console.error('摄像头切换失败:', error);
    isCameraOn.value = false;
  }
};

const toggleMic = () => {
  const isEnabled = webRTC.value.toggleMic();
  isMicOn.value = isEnabled;
};

const toggleParticipantAudio = participantId => {
  if (!isHost.value) return;
  const participant = participants.value.find(p => p.id === participantId);
  if (participant) {
    const isEnabled = webRTC.value.toggleParticipantAudio(participantId);
    participant.isMuted = !isEnabled;
  }
};

const backToHome = () => {
  if (localVideo.value) {
    localVideo.value.srcObject = null; // 清除本地视频流
  }
  webRTC.value.destroy(); // 清理所有WebRTC连接和资源
  hasJoinedRoom.value = false;
  isHost.value = false;
  roomId.value = '';
  remoteVideos.value = [];
  participants.value = [];
  // 重新初始化 WebRTCService 实例
  webRTC.value = new WebRTCService();
  // 重新设置事件监听器
  webRTC.value.on('localStreamReady', stream => {
    if (localVideo.value) {
      localVideo.value.srcObject = stream;
      localVideo.value.play().catch(e => console.error('播放本地视频失败:', e));
    }
  });
  webRTC.value.on('remoteStream', ({ peerId, stream }) => {
    const existingVideo = remoteVideos.value.find(v => v.id === peerId);
    const videoObj = {
      id: peerId,
      stream: stream,
      isMuted: false,
    };
    if (existingVideo) {
      Object.assign(existingVideo, videoObj);
    } else {
      remoteVideos.value.push(videoObj);
      const existingParticipant = participants.value.find(p => p.id === peerId);
      if (!existingParticipant) {
        participants.value.push({
          id: peerId,
          isMuted: false,
          connectionStatus: '已连接',
          connectionQuality: {
            rtt: 0,
            packetLossRate: 0,
            signalStrength: 0,
          },
        });
      }
    }
  });
};

onUnmounted(() => {
  webRTC.value.destroy();
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
        <button @click="backToHome">返回主页</button>
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
          <div class="connection-quality" v-if="participant.connectionQuality">
            <div class="quality-item">
              <span class="quality-label">延迟:</span>
              <span
                class="quality-value"
                :class="{
                  good: participant.connectionQuality.rtt < 100,
                  medium: participant.connectionQuality.rtt >= 100 && participant.connectionQuality.rtt < 300,
                  poor: participant.connectionQuality.rtt >= 300,
                }"
              >
                {{ Math.round(participant.connectionQuality.rtt) }}ms
              </span>
            </div>
            <div class="quality-item">
              <span class="quality-label">丢包率:</span>
              <span
                class="quality-value"
                :class="{
                  good: participant.connectionQuality.packetLossRate < 1,
                  medium: participant.connectionQuality.packetLossRate >= 1 && participant.connectionQuality.packetLossRate < 5,
                  poor: participant.connectionQuality.packetLossRate >= 5,
                }"
              >
                {{ Math.round(participant.connectionQuality.packetLossRate) }}%
              </span>
            </div>
            <div class="quality-item">
              <span class="quality-label">信号强度:</span>
              <span
                class="quality-value"
                :class="{
                  good: participant.connectionQuality.signalStrength >= 70,
                  medium: participant.connectionQuality.signalStrength >= 30 && participant.connectionQuality.signalStrength < 70,
                  poor: participant.connectionQuality.signalStrength < 30,
                }"
              >
                {{ Math.round(participant.connectionQuality.signalStrength) }}%
              </span>
            </div>
          </div>
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
  color: #333;
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
.connection-quality {
  display: flex;
  gap: 15px;
  margin-top: 5px;
}

.quality-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.quality-label {
  font-size: 14px;
  color: #666;
}

.quality-value {
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 500;
}

.quality-value.good {
  background-color: #4caf50;
  color: white;
}

.quality-value.medium {
  background-color: #ff9800;
  color: white;
}

.quality-value.poor {
  background-color: #f44336;
  color: white;
}
</style>
